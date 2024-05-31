document.addEventListener('alpine:init', () => {

  Alpine.data('vidchat', () => ({
    
    /**
     * ============ Functionality ============ 
     */

    site_url : null,
    create_meeting_id : null,
    meeting_id : null,
    peer : null,
    my_peer_id : null,
    my_participant_id : null,
    my_connected_peers : {},
    my_stream : null,
    event_source : null,
    create_meeting_enabled : true,
    join_meeting_enabled : false,
    hangup_enabled : false,

    async initialize() {

      this.site_url = vidchat_main.site_url
      this.create_meeting_id = this.create_id()

      if (!sessionStorage.getItem('my_participant_id')) {
        sessionStorage.setItem('my_participant_id', this.create_id())
      }

      this.my_participant_id = sessionStorage.getItem('my_participant_id')
      
      let url_params = new URLSearchParams(window.location.search)
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
          this.join_meeting_enabled = true

          //  Get local stream
          navigator.mediaDevices.getUserMedia({ video: true, audio: true })
          .then((stream) => {
            this.my_stream = stream
            document.getElementById('local_stream').srcObject = this.my_stream
          })
        })

        this.answer()

        this.create_meeting_enabled = false
      }
      
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
        console.log(data)
        if (data.status === 'success') {
          window.location.href = this.site_url +'/vidchat?meeting-id='+ this.create_meeting_id
        }
      })
    },

    join_meeting() {

      //  Add peer id to vidchat option
      let post_data = new FormData
      post_data.append('meeting_id', this.meeting_id)
      post_data.append('my_peer_id', this.my_peer_id)
      post_data.append('my_participant_id', this.my_participant_id)

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

        if (data.status && data.status === 'success') {

          console.log(data.my_peers)

          if (Object.values(data.my_peers).length > 0) {
            
            Object.values(data.my_peers).forEach(peer_id => {
              this.call(peer_id, this.my_stream)
            });
          }
        }

        if (data.status && data.status === 'error') {
          console.log('Error: '+ data.error_message)
        }
      })
    },

    call(peers_id, my_stream) {

      let call = this.peer.call(peers_id, my_stream);
      call.on('stream', function(my_peers_stream) {

        let video_id = 'stream-'+ my_peers_stream.id;

        if (!document.getElementById(video_id)) {

          let participant = document.createElement('div')
          participant.classList.add('participant')
          participant.innerHTML = `<div class="video_wrap">
            <video id="`+ video_id +`" autoplay playsinline></video>
          </div>`
    
          document.getElementById('wrap').append(participant)
          document.getElementById(video_id).srcObject = my_peers_stream
  
          call.on('close', () => {
            document.getElementById(video_id).parentElement.parentElement.remove()
          })
        }
      }) 
    },

    answer() {

      this.peer.on('call', function(call) {

        navigator.mediaDevices.getUserMedia({video: true, audio: true})
        .then((stream) => {

          call.answer(stream); // Answer the call with an A/V stream.
          call.on('stream', function(my_peers_stream) {
            
            let video_id = 'stream-'+ my_peers_stream.id;

            if (!document.getElementById(video_id)) {

              let participant = document.createElement('div')
              participant.classList.add('participant')
              participant.innerHTML = `<div class="video_wrap">
                <video id="`+ video_id +`" autoplay playsinline></video>
              </div>`
        
              document.getElementById('wrap').append(participant)
              document.getElementById(video_id).srcObject = my_peers_stream
      
              call.on('close', () => {
                document.getElementById(video_id).parentElement.parentElement.remove()
              })

              // console.log('From answer')
            }
          })

          call.on('close', function(obj) {
            console.log(obj)
            console.log('Closed')
          })

        })
      })
    },

    add_participant() {

    },

    hang_up() {

    },

    /**
     * ============ User Interface ============ 
     */
    
    in_call_session : false,
    device_selection_content : false,
    before_call_icon_content : true,
    before_call_settings_content : true,
    in_call_settings_content : false,
    in_call_chat_content : false,
    go_to_room : '', 

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

    http_requesting : false,

    call_session(state) {

      this.in_call_session = state

      if (this.in_call_session) {
        this.before_call_icon_content = false
        this.before_call_settings_content = false
        this.in_call_settings_content = true
        this.in_call_chat_content = true

      } else {
        this.before_call_icon_content = true
        this.before_call_settings_content = true
        this.in_call_settings_content = false
        this.in_call_chat_content = false
      }
    },

    toggle_device_settings() {
      this.device_selection_content = !this.device_selection_content

      if (this.device_selection_content) {
        this.before_call_settings_content = false
        this.before_call_icon_content = false

      } else {
        this.before_call_settings_content = true
        this.before_call_icon_content = true
      }
    },

    toggle_invite_participant_state() {
      this.invite_participant_state = !this.invite_participant_state
    },

    toggle_chatbox() {
      this.chatbox_state = !this.chatbox_state
    },

    toggle_call_settings_menu_state() {
      this.call_settings_menu_state = !this.call_settings_menu_state
    },

    toggle_camera() {
      this.camera_state = !this.camera_state
    },

    toggle_mic() {
      this.mic_state = !this.mic_state
    },

    toggle_screenshare() {
      this.screenshare_state = !this.screenshare_state
    },

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
    }
  }))

})