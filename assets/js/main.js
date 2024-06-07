document.addEventListener('alpine:init', () => {

  Alpine.data('vidchat', () => ({
    
    /**
     * =================================== Functionality =================================== 
     */

    site_url : null,
    create_meeting_id : null,
    meeting_id : null,
    peer : null,
    my_peer_id : null,
    my_participant_id : null,
    my_stream : null,
    peer_server_ready : false,
    entering_room : false,
    media_connection_collection : {},
    my_stream_collection : {},
    data_connection_collection : {},
    media_devices_constraints : null,
    current_screen_stream : null,
    video_monitoring : {},
    is_speaking : false,

    initialize() {

      let url_params = new URLSearchParams(window.location.search)

      if (url_params.get('error')) {
        alert(url_params.get('error'))
        const url = window.location.protocol + "//" + window.location.host + window.location.pathname
        history.replaceState({ path: url }, '', url)
      }

      this.site_url = vidchat_main.site_url
      this.create_meeting_id = this.create_id()

      if (!sessionStorage.getItem('vidchat_my_participant_id')) {
        sessionStorage.setItem('vidchat_my_participant_id', this.create_id())
      }

      this.my_participant_id = sessionStorage.getItem('vidchat_my_participant_id')
      
      if (url_params.get('meeting-id')) {

        this.meeting_id = url_params.get('meeting-id')

        this.peer = new Peer({ 'iceServers': [{ 
            'urls': [
              'stun:stun1.l.google.com:19302', 
              'stun:stun2.l.google.com:19302'
            ] 
          }], 'sdpSemantics': 'unified-plan' 
        })

        this.peer.on('open', (id) => {
          this.my_peer_id = id
          this.peer_server_ready = true
        })

        this.answer()
        this.data_connection()

        //  Add available input devices on device option
        this.enlist_media_devices()

        //  Add drag and drop capability to group chat view
        // this.add_drag_drop_capability(document.getElementById('group_chat'))
        this.add_drag_drop_capability(document.getElementById('chat_input'))

        //  Enable disable chat
        this.enable_disable_chat()

        //  Show page load notification
        this.page_load_info = true
      }
      
      //  Listen for device changes
      navigator.mediaDevices.addEventListener('devicechange', () => {
        this.enlist_media_devices()
      })

      //  Remove participant on page reload or close
      window.addEventListener('beforeunload', () => {

        let post_data = new FormData
        post_data.append('meeting_id', this.meeting_id)
        post_data.append('my_participant_id', this.my_participant_id)

        fetch(this.site_url +'/wp-json/vidchat/v1/remove-participant', {
          method : 'POST',
          keepalive: true, // Important: Will not work without this option
          body : post_data
        })
      })

      //  Initialize group chat storage
      sessionStorage.setItem('vidchat_group_chat', JSON.stringify([]))

      //  Hang up call when on mobile device and tab or browser is inactive for 60 seconds
      if (this.is_mobile()) {

        let timeout_id = null

        document.addEventListener('visibilitychange', () => {

          if (document.hidden) {

            for (let key in this.data_connection_collection) {

              let conn = this.data_connection_collection[key]
              conn.send(JSON.stringify({
                "type": "state",
                "participant_id" : this.my_peer_id,
                "component" : "browser_visibility",
                "state" : false
              }))
            }

            timeout_id = setTimeout(() => {
              if (document.hidden) {
                this.hang_up()
              }
            }, 60000)
            
          } else {

            for (let key in this.data_connection_collection) {

              let conn = this.data_connection_collection[key]
              conn.send(JSON.stringify({
                "type": "state",
                "participant_id" : this.my_peer_id,
                "component" : "browser_visibility",
                "state" : true
              }))
            }

            if (timeout_id) {
              clearTimeout(timeout_id)
            }
          }
        })

        // this.check_has_back_camera()
      }
    },

    create_id() { 
      const groups = []
      for (let i = 0; i < 4; i++) {
          const group = Array.from({ length: 8 }, () => {
            const charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
            return charset.charAt(Math.floor(Math.random() * charset.length))
          }).join('')
          groups.push(group)
      }

      return groups.join('-')
    },

    create_meeting() {

      let post_data = new FormData
      post_data.append('meeting_id', this.create_meeting_id)

      fetch(this.site_url +'/wp-json/vidchat/v1/create-meeting', {
        method : 'POST',
        body : post_data
      })
      .then(response => {
        if (response.ok) {
          return response.json()
        }
      })
      .then(data => {
        if (data.status === 'success') {
          window.location.href = this.site_url +'/vidchat?meeting-id='+ this.create_meeting_id
        }
      })
    },

    async join_meeting() {

      this.page_load_info = false

      if (document.getElementById('video_input').value === '') {
        alert('No video input device found. Please check you have camera and is plugged in.')
        return
      }

      if (document.getElementById('audio_input').value === '') {
        alert('No audio input device found. Please check you have microphone and is plugged in.')
        return
      }

      //  Discontinue process if participant did not input name
      if (document.getElementById('my_participant_name').value === '') {
        this.show_enter_name_modal = true
        return
      }

      this.show_enter_name_modal = false
      this.entering_room = true
      
      //  Add peer id to vidchat option
      let post_data = new FormData
      post_data.append('meeting_id', this.meeting_id)
      post_data.append('my_peer_id', this.my_peer_id)
      post_data.append('my_participant_id', this.my_participant_id)

      //  Setup media devices to use
      this.media_devices_constraints = {
        video: {
          deviceId: { exact: document.getElementById('video_input').value },
          width: { exact: 640 },
          height: { exact: 480 }
        },
        audio: {
          deviceId: { exact: document.getElementById('audio_input').value },
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      }

      //  Get local stream
      this.my_stream = await navigator.mediaDevices.getUserMedia(this.media_devices_constraints)

      fetch(this.site_url +'/wp-json/vidchat/v1/join-meeting', {
        method : 'POST',
        body : post_data
      })
      .then(response => {
        if (response.ok) {
          return response.json()
        }
      })
      .then(data => {

        console.log(data)

        if (data.status && data.status === 'success') {

          this.entering_room = false
          this.call_session(true)
          document.getElementById('local_stream').srcObject = this.my_stream

          if (Object.values(data.my_peers).length > 0) {
            Object.values(data.my_peers).forEach(peer_id => {
              this.call(peer_id, this.my_stream)
            });
          }

          //  Start monitoring videos
          this.monitor_videos()
        }

        if (data.status && data.status === 'error') {
          console.log('Error: '+ data.error_message)
          alert(`There's been an error connecting to the room. Please reload the page and try again.`)
        }
      })

      this.set_participant_name()
    },

    call(peers_id, my_stream) {

      let call = this.peer.call(peers_id, my_stream);

      this.my_stream_collection[call.peer] = my_stream

      this.stream(call)
      this.data_connect(peers_id)
    },

    answer() {

      this.peer.on('call', async (call) => {

        let my_stream = await navigator.mediaDevices.getUserMedia({video: true, audio: true})
        this.my_stream_collection[call.peer] = my_stream

        call.answer(my_stream); // Answer the call with an A/V stream.
        this.stream(call)

        //  Send screenshare tracks if screenshare state is true
        if (this.screenshare_state) {
          const screen_stream_video_track = this.current_screen_stream.getVideoTracks()[0]
          let peer = this.media_connection_collection[call.peer].peerConnection.getSenders().find(s => s.track.kind === screen_stream_video_track.kind) //  This here is a track finder
          peer.replaceTrack(screen_stream_video_track)
        }

        //  Set camera state if camera is in off state
        if (!this.camera_state) {
          let video_track = this.my_stream_collection[call.peer].getVideoTracks()[0]
          video_track.enabled = false
        }

        //  Set microphone state if microphone is in off state
        if (!this.mic_state) {
          let audio_track = this.my_stream_collection[call.peer].getAudioTracks()[0]
          audio_track.enabled = false
        }
        
      })
    },

    data_connect(peers_id) {

      let conn = this.peer.connect(peers_id)
  
      conn.on('open', () => {
        
        conn.send(JSON.stringify({
          "type" : "connected",
          "peer_id" : this.my_peer_id,
          "peer_name" : this.my_participant_name
        }))

        //  Send and set camera state if camera is in off state
        if (!this.camera_state) {

          let video_track = this.my_stream_collection[peers_id].getVideoTracks()[0]
          video_track.enabled = false

          conn.send(JSON.stringify({
            "type": "state",
            "participant_id" : this.my_peer_id,
            "component" : "camera",
            "state" : this.camera_state
          }))
        }

        //  Send and set microphone state if microphone is in off state
        if (!this.mic_state) {

          let audio_track = this.my_stream_collection[peers_id].getAudioTracks()[0]
          audio_track.enabled = false

          conn.send(JSON.stringify({
            "type": "state",
            "participant_id" : this.my_peer_id,
            "component" : "mic",
            "state" : this.mic_state
          }))
        }

        this.data_connection_collection[peers_id] = conn
      })
    },

    data_connection() {

      this.peer.on('connection', (conn) => {

        let peers_id = conn.peer

        conn.on('data', (data) => {

          if (typeof data === 'string' && data !== null) {

            let json_data = JSON.parse(data)

            //  Add new connection to data connections collections
            if (!this.data_connection_collection[peers_id]) {
  
              let this_conn = this.peer.connect(peers_id)
              this.data_connection_collection[peers_id] = this_conn
  
              //  Confirm connection
              this_conn.on('open', () => {

                this_conn.send(JSON.stringify({
                  "type" : "connection_confirmed",
                  "peer_id" : this.my_peer_id,
                  "peer_name" : this.my_participant_name
                }))

                //  Send camera state if camera is in off state
                if (!this.camera_state) {

                  this_conn.send(JSON.stringify({
                    "type": "state",
                    "participant_id" : this.my_peer_id,
                    "component" : "camera",
                    "state" : this.camera_state
                  }))
                }

                //  Send microphone state if microphone is in off state
                if (!this.mic_state) {

                  this_conn.send(JSON.stringify({
                    "type": "state",
                    "participant_id" : this.my_peer_id,
                    "component" : "mic",
                    "state" : this.mic_state
                  }))
                }

                //  Send group chat storage
                this_conn.send(JSON.stringify({
                  "type": "group_chat_storage",
                  "participant_id" : this.my_peer_id,
                  "data" : sessionStorage.getItem('vidchat_group_chat')
                }))
              })
            }

            //  Check if group chat session storage sent is updated than own session storage
            if (json_data.type === 'group_chat_storage') {

              const group_chat_storage = json_data.data

              if (JSON.parse(group_chat_storage).length > JSON.parse(sessionStorage.getItem('vidchat_group_chat')).length) {

                sessionStorage.setItem('vidchat_group_chat', group_chat_storage) // Update group chat storage
              
                if (JSON.parse(sessionStorage.getItem('vidchat_group_chat')).length > 0) {

                  //  Check if there are existing messages then remove if any
                  const group_chat_messages = document.querySelectorAll('#group_chat .participant_message')
                  if (group_chat_messages.length > 0) {
                    group_chat_messages.forEach(participant_message => {
                      participant_message.remove()
                    })
                  }

                  //  Start adding messages to group chat
                  const vidchat_group_chat = JSON.parse(sessionStorage.getItem('vidchat_group_chat'))
                  for (const key in vidchat_group_chat) {
                    
                    if (vidchat_group_chat[key].type === 'file-group') {

                      let owner = vidchat_group_chat[key].participant_id === this.my_participant_id ? 'mine' : 'not_mine'

                      let message_participant_name = vidchat_group_chat[key].name
                      let message_id = 'message_'+ this.create_id()
  
                      let target_chat_messages_wrap = document.getElementById('group_chat')
                      if (target_chat_messages_wrap.classList.contains('empty')) {
                        target_chat_messages_wrap.classList.remove('empty')
                        target_chat_messages_wrap.querySelector('.no_convo').remove()
                      }
  
                      //  Append message to chat box
                      let participant_message = this.create_file_message_html(message_id, owner, message_participant_name, vidchat_group_chat[key].filename, this.base64_to_arraybuffer(vidchat_group_chat[key].data))
                      target_chat_messages_wrap.append(participant_message)
                      document.querySelector(`#${message_id} .message`).classList.add('appended')
  
                    } else {

                      let owner = vidchat_group_chat[key].participant_id === this.my_participant_id ? 'mine' : 'not_mine'

                      let message_participant_name = vidchat_group_chat[key].name
                      let message_id = 'message_'+ this.create_id()
  
                      let target_chat_messages_wrap = document.getElementById('group_chat')
                      if (target_chat_messages_wrap.classList.contains('empty')) {
                        target_chat_messages_wrap.classList.remove('empty')
                        target_chat_messages_wrap.querySelector('.no_convo').remove()
                      }
  
                      //  Append message to chat box
                      let participant_message = this.create_message_html(message_id, owner, message_participant_name, vidchat_group_chat[key].message)
                      target_chat_messages_wrap.append(participant_message)
                      document.querySelector(`#${message_id} .message`).classList.add('appended')
                    }
                  }
                }
              }
            }
  
            //  Setup chat view
            if (json_data.type && (json_data.type === 'connected' || json_data.type === 'connection_confirmed')) {
              this.add_chat_messages_view(json_data.peer_id, json_data.peer_name)
            }
  
            //  Broadcast camera or microphone state to peer
            if (json_data.type && json_data.type === 'state') {
              
              if (json_data.component === 'camera') {
                let style = json_data.state ? 'display:none;' : 'display:block;'
                document.querySelector('#peer-'+ json_data.participant_id +' .media_indicators .camera_off').style = style
  
              } else if (json_data.component === 'mic') {
                let style = json_data.state ? 'display:none;' : 'display:block;'
                document.querySelector('#peer-'+ json_data.participant_id +' .media_indicators .mic_off').style = style

              } else if (json_data.component === 'browser_visibility') {
                let style = json_data.state ? 'display:none;' : 'display:flex;'
                document.querySelector('#peer-'+ json_data.participant_id +' .user_inactive').style = style

              } else {
                //  Do nothing
              }
            }
  
            //  Add chat messages to chat messages view
            if (json_data.type && (json_data.type === 'message' || json_data.type === 'message-group')) {
  
              let message_participant_name = this.chat_channel[json_data.from].name
              let message_id = 'message_'+ this.create_id()
  
              let target_chat_messages_wrap = json_data.type === 'message-group' ? document.getElementById('group_chat') : document.getElementById('chat_messages_'+ json_data.from)
  
              if (target_chat_messages_wrap.classList.contains('empty')) {
                target_chat_messages_wrap.classList.remove('empty')
                target_chat_messages_wrap.querySelector('.no_convo').remove()
              }
  
              //  Append message to chat box
              let participant_message = this.create_message_html(message_id, 'not_mine', message_participant_name, json_data.message)
              target_chat_messages_wrap.append(participant_message)
              
              //  Scroll down the messages wrapper first
              target_chat_messages_wrap.scrollTo({ top: target_chat_messages_wrap.offsetHeight })
  
              setTimeout(() => {
                document.querySelector(`#${message_id} .message`).classList.add('appended')
                document.getElementById('participant_messaged_audio').play()
              }, 500)

              //  Add notification indicator
              if (!this.chat_channel[json_data.from].state || !this.chatbox_state) {

                if (json_data.type === 'message-group') {
                  this.chat_channel.group.has_new_message = true
                } else {
                  this.chat_channel[json_data.from].has_new_message = true
                }
                
                this.check_all_peers_for_new_message()
              } 
              
              //  Update group message storage
              if (json_data.type === 'message-group') {
                this.update_group_chat_storage(json_data)
              }
            }

          } else {

            //  IMPORTANT: RAW DATA JSON OBJECT IS TO BE RECIEVED
            //  Recieve file message
            if (data.type && (data.type === 'file' || data.type === 'file-group')) {

              let message_participant_name = this.chat_channel[data.from].name
              let message_id = 'message_'+ this.create_id()

              let target_chat_messages_wrap = data.type === 'file-group' ? document.getElementById('group_chat') : document.getElementById('chat_messages_'+ data.from)

              if (target_chat_messages_wrap.classList.contains('empty')) {
                target_chat_messages_wrap.classList.remove('empty')
                target_chat_messages_wrap.querySelector('.no_convo').remove()
              }

              let participant_message = this.create_file_message_html(message_id, 'not_mine', message_participant_name, data.filename, data.data)
              target_chat_messages_wrap.append(participant_message)

              //  Scroll down the messages wrapper first
              target_chat_messages_wrap.scrollTo({ top: target_chat_messages_wrap.offsetHeight })

              setTimeout(() => {
                document.querySelector(`#${message_id} .message`).classList.add('appended')
                document.getElementById('participant_messaged_audio').play()
              }, 500)

              //  Add notification indicator
              if (!this.chat_channel[data.from].state || !this.chatbox_state) {

                if (data.type === 'file-group') {
                  this.chat_channel.group.has_new_message = true
                } else {
                  this.chat_channel[data.from].has_new_message = true
                }

                this.check_all_peers_for_new_message()
              }

              //  Update group message storage
              if (data.type === 'file-group') {
                this.update_group_chat_storage(data, true)
              }
            }

          }

        })
      })
    },

    stream(call) {

      this.media_connection_collection[call.peer] = call  // Push to collections for later access

      let media_connection_collection = this.media_connection_collection
      let my_stream_collection = this.my_stream_collection
      let data_connection_collection = this.data_connection_collection
      let chat_channel = this.chat_channel
      let video_monitoring = this.video_monitoring
      let relayout_videos = () => { this.relayout_videos() }
      let enable_disable_chat = () => { this.enable_disable_chat() }
      let fullscreen_state_to_false = () => { this.fullscreen_state = false }
      let update_chat_channel_dropdown = (peer_id) => { this.update_chat_channel_dropdown(peer_id) }

      let peer = call.peer
      let video_id = 'stream-'+ peer
      let peer_id = 'peer-'+ peer

      call.on('stream', function(my_peers_stream) {

        if (!document.getElementById(video_id)) {
          
          let participant = document.createElement('div')
          participant.classList.add('participant')
          participant.id = peer_id
          participant.innerHTML = `<button type="button" class="fullscreen_up_down" title="Fullscreen" @click="toggle_fullscreen('`+ peer_id +`')">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
              <g clip-path="url(#clip0_238_744)">
                <path fill-rule="evenodd" clip-rule="evenodd" d="M15.4166 4.58331H13.3333C13.0017 4.58331 12.6838 4.45162 12.4494 4.2172C12.2149 3.98278 12.0833 3.66483 12.0833 3.33331C12.0833 3.00179 12.2149 2.68385 12.4494 2.44943C12.6838 2.21501 13.0017 2.08331 13.3333 2.08331H15.8333C16.3858 2.08331 16.9157 2.30281 17.3064 2.69351C17.6971 3.08421 17.9166 3.61411 17.9166 4.16665V6.66665C17.9166 6.99817 17.7849 7.31611 17.5505 7.55053C17.316 7.78495 16.9981 7.91665 16.6666 7.91665C16.3351 7.91665 16.0171 7.78495 15.7827 7.55053C15.5483 7.31611 15.4166 6.99817 15.4166 6.66665V4.58331ZM6.66659 4.58331H4.58325V6.66665C4.58325 6.99817 4.45156 7.31611 4.21714 7.55053C3.98272 7.78495 3.66477 7.91665 3.33325 7.91665C3.00173 7.91665 2.68379 7.78495 2.44937 7.55053C2.21495 7.31611 2.08325 6.99817 2.08325 6.66665V4.16665C2.08325 3.61411 2.30275 3.08421 2.69345 2.69351C3.08415 2.30281 3.61405 2.08331 4.16659 2.08331H6.66659C6.99811 2.08331 7.31605 2.21501 7.55047 2.44943C7.78489 2.68385 7.91659 3.00179 7.91659 3.33331C7.91659 3.66483 7.78489 3.98278 7.55047 4.2172C7.31605 4.45162 6.99811 4.58331 6.66659 4.58331ZM6.66659 15.4166H4.58325V13.3333C4.58325 13.0018 4.45156 12.6838 4.21714 12.4494C3.98272 12.215 3.66477 12.0833 3.33325 12.0833C3.00173 12.0833 2.68379 12.215 2.44937 12.4494C2.21495 12.6838 2.08325 13.0018 2.08325 13.3333V15.8333C2.08325 16.3858 2.30275 16.9158 2.69345 17.3065C3.08415 17.6972 3.61405 17.9166 4.16659 17.9166H6.66659C6.99811 17.9166 7.31605 17.7849 7.55047 17.5505C7.78489 17.3161 7.91659 16.9982 7.91659 16.6666C7.91659 16.3351 7.78489 16.0172 7.55047 15.7828C7.31605 15.5483 6.99811 15.4166 6.66659 15.4166ZM13.3333 15.4166H15.4166V13.3333C15.4166 13.0018 15.5483 12.6838 15.7827 12.4494C16.0171 12.215 16.3351 12.0833 16.6666 12.0833C16.9981 12.0833 17.316 12.215 17.5505 12.4494C17.7849 12.6838 17.9166 13.0018 17.9166 13.3333V15.8333C17.9166 16.3858 17.6971 16.9158 17.3064 17.3065C16.9157 17.6972 16.3858 17.9166 15.8333 17.9166H13.3333C13.0017 17.9166 12.6838 17.7849 12.4494 17.5505C12.2149 17.3161 12.0833 16.9982 12.0833 16.6666C12.0833 16.3351 12.2149 16.0172 12.4494 15.7828C12.6838 15.5483 13.0017 15.4166 13.3333 15.4166Z" fill="#E3EEFF"/>
              </g>
              <defs>
                <clipPath id="clip0_238_744">
                  <rect width="20" height="20" fill="white"/>
                </clipPath>
              </defs>
            </svg>
          </button>
          <div class="media_indicators">
            <svg class="mic_off" width="40" height="40" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M5.46676 3.7C5.35232 3.57719 5.21432 3.47869 5.06099 3.41037C4.90766 3.34205 4.74214 3.30531 4.5743 3.30235C4.40646 3.29939 4.23974 3.33026 4.0841 3.39313C3.92845 3.456 3.78706 3.54957 3.66836 3.66827C3.54966 3.78697 3.45609 3.92836 3.39322 4.08401C3.33035 4.23965 3.29948 4.40637 3.30244 4.57421C3.3054 4.74204 3.34214 4.90757 3.41046 5.0609C3.47878 5.21423 3.57728 5.35223 3.70009 5.46667L13.3334 15.1V20C13.3333 21.2117 13.6634 22.4005 14.2883 23.4387C14.9131 24.4769 15.8091 25.3251 16.8799 25.8922C17.9507 26.4593 19.1559 26.7238 20.3657 26.6574C21.5756 26.5909 22.7445 26.196 23.7468 25.515L25.6568 27.425C24.145 28.5581 22.306 29.1693 20.4168 29.1667H19.5834L19.2234 29.16C16.9669 29.0671 14.8337 28.1053 13.27 26.4757C11.7063 24.8462 10.8332 22.6751 10.8334 20.4167V19.5833L10.8218 19.4133C10.7786 19.0996 10.6179 18.8139 10.3723 18.6141C10.1266 18.4142 9.8142 18.315 9.49823 18.3366C9.18226 18.3582 8.88626 18.4989 8.67005 18.7304C8.45383 18.9618 8.33352 19.2666 8.33343 19.5833V20.4167L8.34009 20.81C8.43678 23.5801 9.55268 26.2169 11.4738 28.2149C13.3949 30.2129 15.986 31.4314 18.7501 31.6367V35.4167L18.7618 35.5867C18.8049 35.9004 18.9656 36.1861 19.2113 36.386C19.4569 36.5858 19.7693 36.685 20.0853 36.6634C20.4013 36.6418 20.6973 36.5011 20.9135 36.2697C21.1297 36.0382 21.25 35.7334 21.2501 35.4167L21.2518 31.6367C23.5128 31.4734 25.6707 30.6259 27.4384 29.2067L34.5318 36.3C34.7674 36.5278 35.0831 36.654 35.4109 36.6513C35.7386 36.6486 36.0522 36.5173 36.284 36.2856C36.5159 36.054 36.6475 35.7405 36.6505 35.4128C36.6535 35.085 36.5277 34.7692 36.3001 34.5333L5.46676 3.7ZM28.6601 23.3567L30.5701 25.2667C31.2955 23.753 31.6704 22.0952 31.6668 20.4167V19.5833L31.6551 19.4133C31.6119 19.0996 31.4513 18.8139 31.2056 18.6141C30.9599 18.4142 30.6475 18.315 30.3316 18.3366C30.0156 18.3582 29.7196 18.4989 29.5034 18.7304C29.2872 18.9618 29.1669 19.2666 29.1668 19.5833V20.4167L29.1601 20.7767C29.1255 21.6571 28.9569 22.5271 28.6601 23.3567ZM13.5634 8.26L26.5501 21.2467C26.6279 20.8422 26.6668 20.4267 26.6668 20V10C26.6677 8.38321 26.0811 6.82116 25.0161 5.60468C23.9511 4.3882 22.4804 3.60019 20.8777 3.38736C19.2749 3.17454 17.6495 3.5514 16.3039 4.44778C14.9584 5.34417 13.9844 6.69899 13.5634 8.26Z" fill="#E3EEFF"/>
            </svg>
            <svg class="camera_off" width="30" height="30" viewBox="0 0 30 30" fill="none" xmlns="http://www.w3.org/2000/svg">
              <g clip-path="url(#clip0_85_72)">
                <path fill-rule="evenodd" clip-rule="evenodd" d="M0.471429 2.74286C0.187543 2.4382 0.0329931 2.03524 0.0403393 1.61888C0.0476855 1.20252 0.216354 0.805267 0.51081 0.51081C0.805267 0.216354 1.20252 0.0476852 1.61888 0.040339C2.03524 0.0329929 2.4382 0.187543 2.74286 0.471428L6.55714 4.28571H19.2857C20.1382 4.28571 20.9558 4.62436 21.5586 5.22716C22.1614 5.82995 22.5 6.64752 22.5 7.5V9.09L27.0129 7.155C27.3391 7.01514 27.695 6.95852 28.0485 6.99023C28.4021 7.02193 28.7422 7.14097 29.0384 7.33664C29.3345 7.53231 29.5775 7.79849 29.7453 8.11126C29.9132 8.42404 30.0007 8.77361 30 9.12857V20.8779C30 21.2325 29.9119 21.5815 29.7438 21.8937C29.5756 22.2059 29.3326 22.4715 29.0366 22.6667C28.7405 22.8619 28.4007 22.9805 28.0475 23.012C27.6943 23.0435 27.3388 22.9869 27.0129 22.8471L23.6957 21.4243L29.5286 27.2593C29.6865 27.4064 29.8131 27.5839 29.901 27.781C29.9888 27.9781 30.036 28.1909 30.0398 28.4067C30.0436 28.6225 30.004 28.8369 29.9231 29.037C29.8423 29.2371 29.722 29.4189 29.5694 29.5715C29.4168 29.7241 29.235 29.8444 29.0349 29.9253C28.8347 30.0061 28.6204 30.0458 28.4046 30.042C28.1888 30.0382 27.976 29.9909 27.7788 29.9031C27.5817 29.8153 27.4043 29.6886 27.2571 29.5307L0.471429 2.74286ZM0 7.5C0 7.07143 0.0835714 6.66429 0.235714 6.29357L19.6371 25.695C19.5204 25.7078 19.4031 25.7143 19.2857 25.7143H3.21429C2.3618 25.7143 1.54424 25.3756 0.941442 24.7728C0.338647 24.17 0 23.3525 0 22.5L0 7.5Z" fill="#E3EEFF"/>
              </g>
              <defs>
                <clipPath id="clip0_85_72">
                  <rect width="30" height="30" fill="white"/>
                </clipPath>
              </defs>
            </svg>
          </div>
          <div class="user_inactive" style="display:none;">
            <svg width="40" height="40" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M20 6.66663C21.7681 6.66663 23.4638 7.369 24.714 8.61925C25.9643 9.86949 26.6666 11.5652 26.6666 13.3333C26.6666 16.3997 24.5894 18.9914 21.7649 19.7643C21.446 19.8516 21.1101 19.7434 20.8763 19.5096L13.8248 12.4581C13.5904 12.2237 13.4823 11.8868 13.5703 11.5672C13.933 10.2508 14.6923 9.07286 15.7511 8.19731C16.9464 7.20878 18.4488 6.66754 20 6.66663ZM20.4666 23.3333L30.4666 33.3333L32.629 35.4956C33.0184 35.8851 33.0196 36.5161 32.6317 36.9071L31.9237 37.6206C31.5337 38.0138 30.8984 38.015 30.5067 37.6234L26.5095 33.6262C26.322 33.4386 26.0676 33.3333 25.8024 33.3333H7.66663C7.11435 33.3333 6.66663 32.8856 6.66663 32.3333V30C6.66663 27.3053 9.88369 24.9838 14.4747 23.9288C15.2793 23.7439 15.6136 22.7303 15.0299 22.1465L5.34041 12.4571C4.94988 12.0665 4.94988 11.4334 5.34041 11.0429L6.04329 10.34C6.43365 9.94961 7.06648 9.94942 7.45707 10.3395L20.4666 23.3333ZM33.3333 30V30C33.3333 30.7257 32.4558 31.0892 31.9427 30.576L27.6235 26.2568C26.9192 25.5526 27.5426 24.4693 28.4638 24.8481C31.4387 26.0714 33.3333 27.9267 33.3333 30Z" fill="#E3EEFF"/>
            </svg>
          </div>
          <div class="video_wrap">
            <video id="`+ video_id +`" data-peer_id="${peer}" autoplay playsinline></video>
          </div>`
    
          document.getElementById('participants_wrap').append(participant)
          document.getElementById(video_id).srcObject = my_peers_stream
  
          document.getElementById('participant_joined_audio').play()

          relayout_videos()
          enable_disable_chat()

          video_monitoring[peer] = {
            "minutes_stuck" : 0,
            "previous_time" : 0,
            "current_time" : 0
          }

          document.getElementById('local_stream').muted = true // Mute local video when peers are present

          call.on('close', () => {

            //  Remove from collections objects that are related to the closed connection peer
            let peer_id = call.peer
            delete media_connection_collection[peer_id]
            delete my_stream_collection[peer_id]
            delete data_connection_collection[peer_id]
            delete video_monitoring[peer_id]

            // Remove peer's video element
            document.getElementById(video_id).parentElement.parentElement.remove()

            //  Set peer's chat messages view to group if the closed connection was in view
            if (chat_channel[peer_id].state) {
              chat_channel[peer_id].state = false
              chat_channel['group'].state = true
            }

            // Update chat channel dropdown
            update_chat_channel_dropdown(peer_id)

            //  Check if only one particpant and in fullscreen mode
            let participants = document.querySelectorAll('.participant')
            if (participants.length === 1) {
              
              fullscreen_state_to_false()
              document.getElementById('participants_wrap').classList.remove('in_fullscreen')

              if (participants[0].classList.contains('fullscreen')) {
                participants[0].classList.remove('fullscreen')
              }
            }

            //  Relayout and enable/disable chat
            relayout_videos()
            enable_disable_chat()

            if (Object.keys(video_monitoring).length === 0) {
              document.getElementById('local_stream').muted = false
            }
          })
        }
      })
    },

    add_chat_messages_view(peers_id, peers_name) {

      this.chat_channel[peers_id] = {
        "state" : false,
        "name" : peers_name,
        "has_new_message" : false
      }

      if (!document.getElementById(`chat_messages_${peers_id}`)) {
        //  Append chat messages wrapper
        let chat_messages_wrap = document.createElement('div')
        chat_messages_wrap.setAttribute('x-cloak', '')
        chat_messages_wrap.setAttribute('x-show', "chat_channel['"+ peers_id +"'].state")
        chat_messages_wrap.id = 'chat_messages_'+ peers_id
        chat_messages_wrap.dataset.chat_id = peers_id
        chat_messages_wrap.classList.add('chat_messages_wrap')
        chat_messages_wrap.classList.add('empty')
        chat_messages_wrap.innerHTML = `<p class="no_convo">No conversation yet</p>`

        document.getElementById('chat_peers').insertAdjacentElement('afterend', chat_messages_wrap)
      }

      //  Append to channel selection
      let channel_option = document.createElement('div') 
      channel_option.classList.add('chat_channel')
      channel_option.dataset.name = peers_name
      channel_option.dataset.value = peers_id
      channel_option.setAttribute('x-on:click', 'set_chat_channel(event)')
      channel_option.setAttribute('x-bind:class', `{"has_new_message" : check_has_new_message('${peers_id}')}`)
      channel_option.innerText = peers_name

      document.getElementById('channels').append(channel_option)
    },

    create_message_html(message_id, whose, name, message) {
      
      let whose_class = whose == 'mine' ? 'my_message' : 'others_message'

      let participant_message = document.createElement('div')
      participant_message.id = message_id
      participant_message.classList.add('participant_message')
      participant_message.classList.add(whose_class)
      participant_message.innerHTML = `
        <p class="name">${name}</p>
        <p class="message">${message}</p>`
      
      return participant_message
    },

    create_file_message_html(message_id, whose, name, filename, data) {

      const file_message_title = whose === 'mine' ? 'File sent:' : 'File recieved:'

      const blob = new Blob([data])
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.classList.add('file')
      link.href = url
      link.download = filename
      link.innerHTML = `
        <div class="file_received">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <g clip-path="url(#clip0_352_2)">
              <path d="M12 2V8.5C12 8.87288 12.1389 9.23239 12.3896 9.50842C12.6403 9.78445 12.9848 9.9572 13.356 9.993L13.5 10H20V20C20.0002 20.5046 19.8096 20.9906 19.4665 21.3605C19.1234 21.7305 18.6532 21.9572 18.15 21.995L18 22H6C5.49542 22.0002 5.00943 21.8096 4.63945 21.4665C4.26947 21.1234 4.04284 20.6532 4.005 20.15L4 20V4C3.99984 3.49542 4.19041 3.00943 4.5335 2.63945C4.87659 2.26947 5.34684 2.04284 5.85 2.005L6 2H12ZM14 2.043C14.3234 2.11165 14.6247 2.25939 14.877 2.473L15 2.586L19.414 7C19.6483 7.23411 19.8208 7.52275 19.916 7.84L19.956 8H14V2.043Z" fill="#002155"/>
            </g>
            <defs>
              <clipPath id="clip0_352_2">
                <rect width="24" height="24" fill="white"/>
              </clipPath>
            </defs>
          </svg>
          <div>
            <p class="title">${file_message_title}</p>
            <p>${filename}</p>
          </div>
        </div>`

      let whose_class = whose == 'mine' ? 'my_message' : 'others_message'
      let participant_message = document.createElement('div')
      participant_message.id = message_id
      participant_message.classList.add('participant_message')
      participant_message.classList.add(whose_class)
      participant_message.innerHTML = `
        <p class="name">${name}</p>
        <p class="message"></p>`
      
      participant_message.querySelector('.message').append(link)
      
      return participant_message
    },

    add_drag_drop_capability(drop_area) {

      const data_connection_collection = this.data_connection_collection

      drop_area.addEventListener('dragover', (e) => {
        e.preventDefault()
        drop_area.classList.add('filesend')
      });

      drop_area.addEventListener('dragleave', (e) =>{
        e.preventDefault()
        drop_area.classList.remove('filesend')
      });

      drop_area.addEventListener('drop', (e) => {

        e.preventDefault()
        drop_area.classList.remove('filesend')

        const files = e.dataTransfer.files
        const chat_id = e.target.dataset.chat_id
        const maxsize = 25 * 1024 * 1024  // 25MB Limit
        
        if (files.length > 0) {

          //  Check for sizes
          for (let i=0; i < files.length; i++) {
            if (files[i].size > maxsize) {
              alert('Maximum of 25mb is the file size allowed for sending. Please check the file size of the items before sending.')
              return
            }
          }

          //  Start sending files
          for (let i=0; i < files.length; i++) {

            const fileReader = new FileReader()

            if (chat_id === 'group') {

              for (const key in data_connection_collection) {

                const conn = data_connection_collection[key]

                fileReader.onload = () => {

                  let send_data = {
                    "type": "file-group",
                    "from": this.my_peer_id,
                    "name": this.my_participant_name,
                    "participant_id" : this.my_participant_id,
                    "filename": files[i].name,
                    "data": fileReader.result
                  }

                  //  IMPORTANT NOTE: RAW DATA SHOULD BE SENT SO THAT FILE READER RESULT OBJECT IS INTACT AND NOT CORRUPTED
                  conn.send(send_data)

                  let message_id = 'message_'+ this.create_id()
                  let target_chat_messages_wrap = chat_id === 'group' ? document.getElementById('group_chat') : document.getElementById('chat_messages_'+ chat_id)
                  
                  if (target_chat_messages_wrap.classList.contains('empty')) {
                    target_chat_messages_wrap.classList.remove('empty')
                    target_chat_messages_wrap.querySelector('.no_convo').remove()
                  }
            
                  //  Append message to chat box
                  let participant_message = this.create_file_message_html(message_id, 'mine', this.my_participant_name, files[i].name, fileReader.result)
                  target_chat_messages_wrap.append(participant_message)
            
                  //  Scroll down the messages wrapper first
                  target_chat_messages_wrap.scrollTo({ top: target_chat_messages_wrap.offsetHeight })
            
                  setTimeout(() => {
                    document.querySelector(`#${message_id} .message`).classList.add('appended')
                  }, 500)

                  //  Update group message storage
                  this.update_group_chat_storage(send_data, true)
                }

                const blob = new Blob([files[i]])
                fileReader.readAsArrayBuffer(blob)
              }

            } else {

              const conn = data_connection_collection[chat_id]
        
              fileReader.onload = () => {

                //  IMPORTANT NOTE: RAW DATA SHOULD BE SENT SO THAT FILE READER RESULT OBJECT IS INTACT AND NOT CORRUPTED
                conn.send({
                  "type": "file",
                  "from": this.my_peer_id,
                  "name": this.my_participant_name,
                  "participant_id" : this.my_participant_id,
                  "filename": files[i].name,
                  "data": fileReader.result
                })

                let message_id = 'message_'+ this.create_id()
                let target_chat_messages_wrap = chat_id === 'group' ? document.getElementById('group_chat') : document.getElementById('chat_messages_'+ chat_id)
                
                if (target_chat_messages_wrap.classList.contains('empty')) {
                  target_chat_messages_wrap.classList.remove('empty')
                  target_chat_messages_wrap.querySelector('.no_convo').remove()
                }
          
                //  Append message to chat box
                let participant_message = this.create_file_message_html(message_id, 'mine', this.my_participant_name, files[i].name, fileReader.result)
                target_chat_messages_wrap.append(participant_message)
          
                //  Scroll down the messages wrapper first
                target_chat_messages_wrap.scrollTo({ top: target_chat_messages_wrap.offsetHeight })
          
                setTimeout(() => {
                  document.querySelector(`#${message_id} .message`).classList.add('appended')
                }, 500)
              }

              const blob = new Blob([files[i]])
              fileReader.readAsArrayBuffer(blob)
            }
          

          }
        }
      })
    },

    async screenshare() {
      
      try {

        const screen_stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })

        this.current_screen_stream = screen_stream
        const screen_stream_video_track = screen_stream.getVideoTracks()[0]
  
        this.toggle_camera(true)
        this.toggle_mic(true)
  
        document.getElementById('local_stream').srcObject = screen_stream
  
        if (Object.keys(this.media_connection_collection).length > 0) {
  
          // Replace video track with screen track
          for (const key in this.media_connection_collection) {
            let peer = this.media_connection_collection[key].peerConnection.getSenders().find(s => s.track.kind === screen_stream_video_track.kind) //  This here is a track finder
            peer.replaceTrack(screen_stream_video_track)
          }
  
          screen_stream_video_track.onended = () => {
  
            // Revert back to webcam video after screen sharing ends
            for (const key in this.media_connection_collection) {
              let peer = this.media_connection_collection[key].peerConnection.getSenders().find(s => s.track.kind === screen_stream_video_track.kind) //  This here is a track finder
              peer.replaceTrack(this.my_stream.getVideoTracks()[0])
            }
  
            document.getElementById('local_stream').srcObject = this.my_stream;
            this.screenshare_state = false
            this.toggle_camera(true)
            this.toggle_mic(true)
          }
        }
        
      } catch (error) {

        this.screenshare_state = false
        this.toggle_camera(true)
        this.toggle_mic(true)
      }
    },

    send_message() {

      let peers_id = document.getElementById('chat_channel_value').value
      let message = document.getElementById('chat_input').value

      if (peers_id === 'group') {

        let send_data = {
          "type" : "message-group",
          "from" : this.my_peer_id,
          "name" : this.my_participant_name,
          "participant_id" : this.my_participant_id,
          "message" : message
        }

        //  Send to all
        for (const key in this.data_connection_collection) {
          this.data_connection_collection[key].send(JSON.stringify(send_data))
        }

        //  Update group message storage
        this.update_group_chat_storage(send_data)

      } else {

        let send_data = JSON.stringify({
          "type" : "message",
          "from" : this.my_peer_id,
          "name" : this.my_participant_name,
          "participant_id" : this.my_participant_id,
          "message" : message
        })

        //  Send to specific peer
        this.data_connection_collection[peers_id].send(send_data)
      }

      let message_id = 'message_'+ this.create_id()
      let target_chat_messages_wrap = peers_id === 'group' ? document.getElementById('group_chat') : document.getElementById('chat_messages_'+ peers_id)
      
      if (target_chat_messages_wrap.classList.contains('empty')) {
        target_chat_messages_wrap.classList.remove('empty')
        target_chat_messages_wrap.querySelector('.no_convo').remove()
      }

      //  Append message to chat box
      let participant_message = this.create_message_html(message_id, 'mine', this.my_participant_name, message)
      target_chat_messages_wrap.append(participant_message)

      //  Scroll down the messages wrapper first
      target_chat_messages_wrap.scrollTo({ top: target_chat_messages_wrap.offsetHeight })

      setTimeout(() => {
        document.querySelector(`#${message_id} .message`).classList.add('appended')
      }, 500)

      //  Empty chat input box
      document.getElementById('chat_input').value = ''
    },

    input_files_send_files(event) {

      const files = document.getElementById('input_files').files
      const chat_id = event.target.dataset.chat_id
      const maxsize = 25 * 1024 * 1024  // 25MB Limit

      if (files.length > 0) {

        //  Check for sizes
        for (let i=0; i < files.length; i++) {
          if (files[i].size > maxsize) {
            alert('Maximum of 25mb is the file size allowed for sending. Please check the file size of the items before sending.')
            return
          }
        }

        if (chat_id === 'group') {

          for (const key in this.data_connection_collection) {

            for (let i=0; i < files.length; i++) {
          
              let conn = this.data_connection_collection[key]
              let fileReader = new FileReader()
    
              fileReader.onload = () => {
      
                let send_data = {
                  "type": "file-group",
                  "from": this.my_peer_id,
                  "name": this.my_participant_name,
                  "participant_id" : this.my_participant_id,
                  "filename": files[i].name,
                  "data": fileReader.result
                }

                //  IMPORTANT NOTE: RAW DATA SHOULD BE SENT SO THAT FILE READER RESULT OBJECT IS INTACT AND NOT CORRUPTED
                conn.send(send_data)
    
                let message_id = 'message_'+ this.create_id()
                let target_chat_messages_wrap = chat_id === 'group' ? document.getElementById('group_chat') : document.getElementById('chat_messages_'+ chat_id)
                
                if (target_chat_messages_wrap.classList.contains('empty')) {
                  target_chat_messages_wrap.classList.remove('empty')
                  target_chat_messages_wrap.querySelector('.no_convo').remove()
                }
          
                //  Append message to chat box
                let participant_message = this.create_file_message_html(message_id, 'mine', this.my_participant_name, files[i].name, fileReader.result)
                target_chat_messages_wrap.append(participant_message)
          
                //  Scroll down the messages wrapper first
                target_chat_messages_wrap.scrollTo({ top: target_chat_messages_wrap.offsetHeight })
          
                setTimeout(() => {
                  document.querySelector(`#${message_id} .message`).classList.add('appended')
                }, 500)

                //  Update group message storage
                this.update_group_chat_storage(send_data, true)
              }
        
              const blob = new Blob([files[i]])
              fileReader.readAsArrayBuffer(blob)
            }

          }

        } else {

          for (let i=0; i < files.length; i++) {
          
            let conn = this.data_connection_collection[chat_id]
            let fileReader = new FileReader()
  
            fileReader.onload = () => {
    
              //  IMPORTANT NOTE: RAW DATA SHOULD BE SENT SO THAT FILE READER RESULT OBJECT IS INTACT AND NOT CORRUPTED
              conn.send({
                "type": "file",
                "from": this.my_peer_id,
                "name": this.my_participant_name,
                "participant_id" : this.my_participant_id,
                "filename": files[i].name,
                "data": fileReader.result
              })
  
              let message_id = 'message_'+ this.create_id()
              let target_chat_messages_wrap = chat_id === 'group' ? document.getElementById('group_chat') : document.getElementById('chat_messages_'+ chat_id)
              
              if (target_chat_messages_wrap.classList.contains('empty')) {
                target_chat_messages_wrap.classList.remove('empty')
                target_chat_messages_wrap.querySelector('.no_convo').remove()
              }
        
              //  Append message to chat box
              let participant_message = this.create_file_message_html(message_id, 'mine', this.my_participant_name, files[i].name, fileReader.result)
              target_chat_messages_wrap.append(participant_message)
        
              //  Scroll down the messages wrapper first
              target_chat_messages_wrap.scrollTo({ top: target_chat_messages_wrap.offsetHeight })
        
              setTimeout(() => {
                document.querySelector(`#${message_id} .message`).classList.add('appended')
              }, 500)
            }
      
            const blob = new Blob([files[i]])
            fileReader.readAsArrayBuffer(blob)
          }

        }
      }

      setTimeout(() => {
        document.getElementById('input_files').value = null
      }, 1000)
    },

    update_group_chat_storage(data, is_file = false) {
      
      if (sessionStorage.getItem('vidchat_group_chat')) {
        this.group_chat_container = JSON.parse(sessionStorage.getItem('vidchat_group_chat'))
      }

      if (is_file) {
        data.data = this.arraybuffer_to_base64(data.data)
      }

      this.group_chat_container.push(data)
      sessionStorage.setItem('vidchat_group_chat', JSON.stringify(this.group_chat_container))
    },

    arraybuffer_to_base64(buffer) {

      let binary = '';
      const bytes = new Uint8Array(buffer);
      const len = bytes.byteLength;
      for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      return window.btoa(binary);
    },

    base64_to_arraybuffer(base64) {

      const binaryString = window.atob(base64);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      return bytes.buffer;
    },

    send_invitation(recipient_input) {

      if (!document.getElementById('my_participant_name').value) {
        alert('Please set your name first before sending an invitation. To enter your name click on the button with the gear icon.')
        return
      }

      if (!recipient_input.value) {
        alert('Please enter the email address of the recipient.')
        return
      }

      let participant_name = document.getElementById('my_participant_name').value

      let post_data = new FormData
      post_data.append('recipient', recipient_input.value)
      post_data.append('meeting_id', this.meeting_id)
      post_data.append('participant_name', participant_name)

      this.http_requesting = true

      fetch(this.site_url +'/wp-json/vidchat/v1/invite-participant', {
        method : 'POST',
        body : post_data
      })
      .then(response => {
        if (response.ok) {
          this.http_requesting = false
          return response.json()
        }
      })
      .then(data => {

        if (data.status === 'success') {

          this.invitation_status_state = true
          recipient_input.value = ''
          
          setTimeout(() => {
            this.invitation_status_state = false
          }, 1000)
        }

        if (data.status === 'error') {
          console.log('Error inviting peer: '+ data.error_message)
        }
      })
    },

    async hang_up() {

      if (this.in_call_session && this.media_connection_collection) {

        this.hanging_up = true

        let post_data = new FormData
        post_data.append('meeting_id', this.meeting_id)
        post_data.append('my_participant_id', this.my_participant_id)

        //  Unregister peer id from database
        let response = await fetch(this.site_url +'/wp-json/vidchat/v1/remove-participant', {
          method : 'POST',
          keepalive: true, // Important: Will not work without this option
          body : post_data
        })

        let json_data = await response.json()

        if (json_data.status === 'success') {

          //  Close all media connections
          for (const key in this.media_connection_collection) {
            if (this.media_connection_collection[key]) {
              let media_connection = this.media_connection_collection[key]
              media_connection.close()
            }
          }

          //  Stop screen share stream
          if (this.screen_stream) {
            this.screen_stream.getTracks().forEach(track => track.stop())
            this.screen_stream = null
          }

          //  Stop local stream
          if (this.my_stream) {
            this.my_stream.getTracks().forEach(track => track.stop())
            this.my_stream = null
          }

          //  Re-initialize group chat storage
          sessionStorage.setItem('vidchat_group_chat', JSON.stringify([]))

          this.call_session(false)

          this.hanging_up = false

        } else {
          console.log(json_data.error_message)
        }        
      }
    },

    monitor_videos() {

      setInterval(() => {

        document.querySelectorAll('.participant video').forEach(video => {

          if (video.id !== 'local_stream') {

            let peer_id = video.dataset.peer_id

            //  Assign values
            this.video_monitoring[peer_id].previous_time = this.video_monitoring[peer_id].current_time
            this.video_monitoring[peer_id].current_time = video.currentTime

            //  Count the minutes if the video is not playing (Assumed interval is every 30 seconds)
            if (this.video_monitoring[peer_id].previous_time === this.video_monitoring[peer_id].current_time) {
              this.video_monitoring[peer_id].minutes_stuck = this.video_monitoring[peer_id].minutes_stuck + 0.5
            } else {
              this.video_monitoring[peer_id].minutes_stuck = 0
            }

            //  Check if video is past or equal to the alloted minutes not playing
            if (this.video_monitoring[peer_id].minutes_stuck >= 1.5) {
              
              //  Remove from collections objects that are related to the closed connection peer
              delete this.media_connection_collection[peer_id]
              delete this.my_stream_collection[peer_id]
              delete this.data_connection_collection[peer_id]
              delete this.video_monitoring[peer_id]

              // Remove peer's video element
              video.parentElement.parentElement.remove()

              //  Set peer's chat messages view to group if the closed connection was in view
              if (this.chat_channel[peer_id].state) {
                this.chat_channel[peer_id].state = false
                this.chat_channel['group'].state = true
              }

              // Update chat channel dropdown
              this.update_chat_channel_dropdown(peer_id)

              //  Check if only one particpant and in fullscreen mode
              let participants = document.querySelectorAll('.participant')
              if (participants.length === 1) {
                
                this.fullscreen_state = false
                document.getElementById('participants_wrap').classList.remove('in_fullscreen')

                if (participants[0].classList.contains('fullscreen')) {
                  participants[0].classList.remove('fullscreen')
                }
              }

              //  Relayout and enable/disable chat
              this.relayout_videos()
              this.enable_disable_chat()

              if (Object.keys(this.video_monitoring).length === 0) {
                document.getElementById('local_stream').muted = false
              }
            }
          }

        })

      }, 30000)
    },

    is_mobile() {

      const user_agent = navigator.userAgent;

      // Checks for iOS devices
      if (/iPhone|iPad|iPod/i.test(user_agent)) {
        return true;
      }
  
      // Checks for Android devices
      if (/Android/i.test(user_agent)) {
        return true;
      }
  
      // Checks for other mobile devices
      if (/Mobile|webOS|BlackBerry|IEMobile|Opera Mini/i.test(user_agent)) {
        return true;
      }
  
      return false;
    },

    /**
     * =================================== User Interface =================================== 
     */
    
    in_call_session : false,
    device_selection_content : false,
    before_call_icon_content : true,
    before_call_settings_content : true,
    in_call_settings_content : false,
    in_call_chat_content : false,
    in_call_howto_content : false,
    my_participant_name : '', 
    show_enter_name_modal : false,
    // has_back_camera: false,
    // back_camera_on : false,
    // back_camera_device_id : null,
    hanging_up : false,
    go_to_room : '',
    page_load_info : false,

    camera_state : true,
    mic_state : true,
    screenshare_state : false,
    invite_participant_state : false,
    chatbox_state : false,
    call_settings_menu_state : false,
    is_copying_state : false,
    invitation_status_state : false,
    fullscreen_state : false,
    fullscreen_peers_state : true,
    media_indicator_camera_state : false,
    media_indicator_mic_state : false, 
    chat_channel_state : false,
    info_how_to_modal_state : {
      "info" : true,
      "how_to" : false
    },

    chat_channel : {
      "group" : {
        "state" : true,
        "name" : "Group",
        "has_new_message" : false
      }
    },
    http_requesting : false,

    call_session(state) {

      this.in_call_session = state

      if (this.in_call_session === true) {
        this.show_enter_name_modal = false
        this.before_call_icon_content = false
        this.before_call_settings_content = false
        this.in_call_settings_content = true
        this.in_call_chat_content = true
        this.in_call_howto_content = true

      } else {
        this.before_call_icon_content = true
        this.before_call_settings_content = true
        this.in_call_settings_content = false
        this.in_call_chat_content = false
        this.in_call_howto_content = false
      }
    },

    toggle_device_settings() {
      this.device_selection_content = !this.device_selection_content

      if (this.device_selection_content) {
        this.before_call_settings_content = false
        this.before_call_icon_content = false
        this.show_enter_name_modal = false

      } else {
        this.before_call_settings_content = true
        this.before_call_icon_content = true
        this.show_enter_name_modal = true
      }

      this.show_enter_name_modal = false
      this.page_load_info = false
    },

    toggle_invite_participant_state() {
      this.invite_participant_state = !this.invite_participant_state
    },

    toggle_chatbox() {

      this.chatbox_state = !this.chatbox_state
      if (this.chatbox_state) {
        this.call_settings_menu_state = false
      }

      //  Find the active chat view and check if there is new message then set has_new_message to false
      if (this.chatbox_state) {
        for (const key in this.chat_channel) {
          if (this.chat_channel[key].state && this.chat_channel[key].has_new_message) {
            this.chat_channel[key].has_new_message = false
            break
          }
        }
      }
    },

    toggle_chat_messages_view() {

      for (const key in this.chat_channel) {
        this.chat_channel[key].state = false
      }

      let channel_id = document.getElementById('chat_channel_value').value
      this.chat_channel[channel_id].state = true

      document.getElementById('input_files').dataset.chat_id = channel_id
    },

    set_chat_channel(event) {

      let channel_name = event.target.dataset.name
      let channel_id = event.target.dataset.value

      document.getElementById('channel_name').innerText = channel_name
      document.getElementById('chat_channel_value').value = channel_id

      document.getElementById('chat_input').dataset.chat_id = channel_id //  Set chat id to chatbox for sending files

      this.toggle_chat_messages_view()
      this.chat_channel[channel_id].has_new_message = false

      this.chat_channel_state = false
    },

    toggle_call_settings_menu_state() {
      this.call_settings_menu_state = !this.call_settings_menu_state
      if (this.call_settings_menu_state) {
        this.chatbox_state = false
      }
    },

    toggle_camera(state = null) {

      if (this.my_stream_collection) {

        this.camera_state = state ? state : !this.camera_state

        if (!this.screenshare_state) {

          for (const key in this.my_stream_collection) {

            const stream = this.my_stream_collection[key]
            const video_track = stream.getVideoTracks()[0]
  
            if (video_track) {
              video_track.enabled = this.camera_state
            }
          }

        } else {

          const current_screen_stream_track = this.current_screen_stream.getVideoTracks()[0]
          if (current_screen_stream_track) {
            current_screen_stream_track.enabled = this.camera_state
          }
        }

        //  Broadcast to all peers
        for (const key in this.data_connection_collection) {
          
          const conn = this.data_connection_collection[key]
          conn.send(JSON.stringify({
            "type": "state",
            "participant_id" : this.my_peer_id,
            "component" : "camera",
            "state" : this.camera_state
          }))
        }
      }
    },

    toggle_mic(state = null) {
      
      if (this.my_stream_collection) {

        this.mic_state = state ? state : !this.mic_state

        if (!this.screenshare_state) {

          for (const key in this.my_stream_collection) {
  
            const stream = this.my_stream_collection[key]
            const audio_track = stream.getAudioTracks()[0]
    
            if (audio_track) {
              audio_track.enabled = this.mic_state
            }
          }

        } else {

          const current_screen_stream_track = this.current_screen_stream.getAudioTracks()[0]
          if (current_screen_stream_track) {
            current_screen_stream_track.enabled = this.mic_state
          }
        }

        //  Broadcast to all peers
        for (const key in this.data_connection_collection) {
  
          const conn = this.data_connection_collection[key]
          conn.send(JSON.stringify({
            "type": "state",
            "participant_id" : this.my_peer_id,
            "component" : "mic",
            "state" : this.mic_state
          }))
        }
      }
    },

    toggle_screenshare() {
      this.screenshare_state = !this.screenshare_state

      if (this.screenshare_state) {
        this.screenshare()
      }
    },

    // async toggle_back_camera() {
      
    //   this.back_camera_on = !this.back_camera_on

    //   if (this.back_camera_on) {

    //     if (this.has_back_camera && this.back_camera_device_id) {

    //       // this.media_devices_constraints.video.deviceId.exact = this.back_camera_device_id

    //       const back_camera_constraints = {
    //         video: {
    //             width: { ideal: 640 }, // Ideal width in pixels
    //             height: { ideal: 480 }, // Ideal height in pixels
    //             frameRate: { ideal: 30 }, // Ideal frame rate in frames per second
    //             facingMode: "environment" // "user" for front camera, "environment" for back camera
    //         },
    //         audio: {
    //             echoCancellation: true, // Reduce echo
    //             noiseSuppression: true, // Suppress background noise
    //             autoGainControl: true   // Automatically control gain
    //         }
    //       }

    //       const back_camera_stream = await navigator.mediaDevices.getUserMedia(back_camera_constraints)
    //       const back_camera_stream_videotracks = back_camera_stream.getVideoTracks()[0]
  
    //       // Replace video track with screen track
    //       for (const key in this.media_connection_collection) {
    //         let peer = this.media_connection_collection[key].peerConnection.getSenders().find(s => s.track.kind === back_camera_stream_videotracks.kind) //  This here is a track finder
    //         peer.replaceTrack(back_camera_stream_videotracks)
    //       }
    //     }

    //   } else {

    //     const my_stream_videotracks = this.my_stream.getVideoTracks()[0]

    //     // Replace video track with screen track
    //     for (const key in this.media_connection_collection) {
    //       let peer = this.media_connection_collection[key].peerConnection.getSenders().find(s => s.track.kind === my_stream_videotracks.kind) //  This here is a track finder
    //       peer.replaceTrack(my_stream_videotracks)
    //     }
    //   }
    // },

    // async check_has_back_camera() {

    //   let media_devices = await navigator.mediaDevices.enumerateDevices()

    //   for (const key in media_devices) {

    //     if (media_devices[key].kind === 'videoinput') {

    //       if (media_devices[key].label.toLowerCase().includes('back')) {

    //         console.log(media_devices[key].label)
    //         console.log(media_devices[key].deviceId)

    //         this.back_camera_device_id = media_devices[key].deviceId
    //         this.has_back_camera = true
    //         break
    //       }
    //     }
    //   }

    //   console.log(media_devices)
    //   console.log(this.back_camera_device_id)
    // },

    toggle_fullscreen(element_id) {

      let element = document.getElementById(element_id)

      if (!element.classList.contains('fullscreen')) {

        this.fullscreen_state = true

        document.querySelectorAll('#participants_wrap.in_fullscreen .participant.fullscreen').forEach((element) => {
          element.classList.remove('fullscreen')
        })

        document.getElementById('participants_wrap').classList.add('in_fullscreen')
        element.classList.add('fullscreen')

      } else {
        this.fullscreen_state = false
        document.getElementById('participants_wrap').classList.remove('in_fullscreen')
        element.classList.remove('fullscreen')
      }
    },

    toggle_peers() {
      if (document.getElementById('participants_wrap').classList.contains('in_fullscreen')) {
        this.fullscreen_peers_state = !this.fullscreen_peers_state
      }
    },

    copy_room_link() {
      this.is_copying_state = true
      navigator.clipboard.writeText(window.location.href)
      setTimeout(() => this.is_copying_state = false, 1000)
    },
    
    async enlist_media_devices() {

      await navigator.mediaDevices.getUserMedia({ video: true, audio: true })

      if (document.getElementById('video_input').querySelectorAll('option').length > 0) {
        document.getElementById('video_input').querySelectorAll('option').forEach(option => option.remove())
      }
      
      if (document.getElementById('audio_input').querySelectorAll('option').length > 0) {
        document.getElementById('audio_input').querySelectorAll('option').forEach(option => option.remove())
      }

      let media_devices = await navigator.mediaDevices.enumerateDevices()
      
      for (const key in media_devices) {

        let kind = media_devices[key].kind

        switch (kind) {
          
          case 'videoinput':

            let video_input_option = document.createElement('option')
            video_input_option.value = media_devices[key].deviceId
            video_input_option.innerText = media_devices[key].label
    
            document.getElementById('video_input').append(video_input_option)
            break;

          case 'audioinput':
            
            let audio_input_option = document.createElement('option')
            audio_input_option.value = media_devices[key].deviceId
            audio_input_option.innerText = media_devices[key].label
    
            document.getElementById('audio_input').append(audio_input_option)
            break;

          default:
            break;
        }
      }
    },

    set_participant_name() {
      let name = document.getElementById('my_participant_name').value
      this.my_participant_name = name ? name : 'participant-'+ this.my_participant_id
    },

    participant_name_modal_input(event) {

      document.getElementById('my_participant_name').value = event.target.value

      const participant_name_modal = document.getElementById('participant_name_modal')
      const enter_name_modal_ok = document.getElementById('enter_name_modal_ok')
      
      if (participant_name_modal.value === '') {
        enter_name_modal_ok.setAttribute('disabled', true)
        enter_name_modal_ok.style = 'pointer-events:none;'
      } else {
        enter_name_modal_ok.removeAttribute('disabled')
        enter_name_modal_ok.style = 'pointer-events:auto;'
      }
    },

    participant_name_modal_cancel() {
      this.show_enter_name_modal = false
      this.before_call_icon_content = true
    },

    relayout_videos() {
      
      if (this.in_call_session) {
        
        const participant_count = document.querySelectorAll('#participants_wrap .participant').length
        const participants_wrap = document.getElementById('participants_wrap')
  
        if (participant_count === 1) {
          participants_wrap.style = `grid-template-columns: repeat(1, 1fr)`
          participants_wrap.querySelector(':nth-child(1)').style = ``
  
        } else if (participant_count === 2) {
  
          if (participants_wrap.offsetWidth >= participants_wrap.offsetHeight) {
            participants_wrap.style = `grid-template-columns: repeat(2, 1fr)`
            participants_wrap.querySelector(':nth-child(1)').style = ``
  
          } else {
            participants_wrap.style = `grid-template-columns: repeat(1, 1fr)`
            participants_wrap.querySelector(':nth-child(1)').style = ``
          }
  
        } else if (participant_count === 3) {
          
          if (participants_wrap.offsetWidth >= participants_wrap.offsetHeight) {
            participants_wrap.style = `grid-template-columns: repeat(2, 1fr)`
            participants_wrap.querySelector(':nth-child(1)').style = `grid-column: span 2`
          } else {
            participants_wrap.style = `grid-template-columns: repeat(1, 1fr)`
            participants_wrap.querySelector(':nth-child(1)').style = ``
          }
        } else if (participant_count === 4) {
  
          if (participants_wrap.offsetWidth >= participants_wrap.offsetHeight) {
            participants_wrap.style = `grid-template-columns: repeat(2, 1fr)`
            participants_wrap.querySelector(':nth-child(1)').style = ``
          } else {
            participants_wrap.style = `grid-template-columns: repeat(1, 1fr)`
            participants_wrap.querySelector(':nth-child(1)').style = ``
          }
          
        } else if (participant_count >= 5) {
  
          //  Remove grid span on first child
          participants_wrap.querySelector(':nth-child(1)').style = ``
          
          let columns = 2
  
          if (participants_wrap.offsetWidth >= 1920) {
            columns = 5
          } else if (participants_wrap.offsetWidth >= 1366) {
            columns = 4
          } else if (participants_wrap.offsetWidth >= 800) {
            columns = 3
          } else {
            columns = 2
          }
  
          participants_wrap.style = `grid-template-columns: repeat(${columns}, 1fr)`
        }
      }
    },

    enable_disable_chat() {
      
      let chat_input = document.getElementById('chat_input')
      let send_message = document.getElementById('send_message')
      let send_files = document.getElementById('send_files')
      let participants = document.querySelectorAll('.participant')

      if (participants.length > 1) {
        send_files.disabled = false
        send_files.style = ''
        send_message.disabled = false
        send_message.style = ''
        chat_input.disabled = false
        chat_input.value = ''

      } else {
        send_files.disabled = true
        send_files.style = 'pointer-events:none;'
        send_message.disabled = true
        send_message.style = 'pointer-events:none;'
        chat_input.disabled = true
        chat_input.value = 'Chat disabled no peer recipients yet'
      }
    },

    check_has_new_message(peers_id) {
      return this.chat_channel[peers_id].has_new_message
    },

    check_all_peers_for_new_message() {

      for (const key in this.chat_channel) {
        if (this.chat_channel[key].has_new_message) {
          return true
        }
      }

      return false
    },

    update_chat_channel_dropdown(peers_id) {

      let to_remove_element = document.querySelector(`div.chat_channel[data-value="${peers_id}"]`)

      if (to_remove_element.nextElementSibling) {
        document.getElementById('chat_channel_value').value = to_remove_element.nextElementSibling.dataset.value
        document.getElementById('channel_name').innerText = to_remove_element.nextElementSibling.dataset.name

      } else if (to_remove_element.previousElementSibling) {
        document.getElementById('chat_channel_value').value = to_remove_element.previousElementSibling.dataset.value
        document.getElementById('channel_name').innerText = to_remove_element.previousElementSibling.dataset.name
      }

      to_remove_element.remove()
      this.toggle_chat_messages_view()
    },

    toggle_info_how_to_modal() {
      
      if (document.getElementById('info_howto_modal').classList.contains('show')) {
        document.getElementById('info_howto_modal').classList.remove('show')
      } else {
        document.getElementById('info_howto_modal').classList.add('show')
      }
    },

    toggle_info_how_to_modal_state(tab, state) {

      this.info_how_to_modal_state[tab] = state

      if (tab === 'info') {
        this.info_how_to_modal_state.info = true
        this.info_how_to_modal_state.how_to = false

      } else if (tab === 'how_to') {
        this.info_how_to_modal_state.info = false
        this.info_how_to_modal_state.how_to = true
      }
    },

    close_page_load_info() {
      this.page_load_info = false
    },

    show_page_load_info() {
      setTimeout(() => {
        document.getElementById('page_load_info').classList.add('show')
      }, 150)
    }
  }))

})