<?php get_header(); ?>

<main x-data="vidchat" x-init="initialize()">
  <div id="wrap">
    <div class="participant">
      <div class="video_wrap">
        <video id="local_stream" autoplay playsinline></video>
      </div>
    </div>
  </div>
  <div id="actions">
    <template x-if="create_meeting_enabled">
      <button type="button" id="create_meeting" @click="create_meeting()">Create meeting</button>
    </template>
    <template x-if="hangup_enabled">
      <button type="button" id="hang_up" @click="hang_up()">Hang up</button>
    </template>
    <template x-if="join_meeting_enabled">
      <button type="button" id="join_meeting" @click="join_meeting()">Join meeting</button>
    </template>
  </div>
</main>

<?php get_footer(); ?>

<?php

echo '<pre>';
var_dump(get_option('vidchat'));
echo '</pre>';

// echo '<pre>';
// var_dump(update_option('vidchat', []));
// echo '</pre>';