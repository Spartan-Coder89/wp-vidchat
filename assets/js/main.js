document.addEventListener('alpine:init', () => {

  Alpine.data('vidchat', () => ({
    
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

        this.peer = new Peer({ 'iceServers': [{ 'urls': 'stun:stun.l.google.com:19302' }], 'sdpSemantics': 'unified-plan' })
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

          // console.log('From call')
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

          var conn = peer.connect('another-peers-id');
        })
      })
    },

    hang_up() {

    }

  }))
})