<?php include 'header-vidchat.php'; ?>

<main x-data="vidchat" x-init="initialize()">
  <?php 
    if (isset($_GET['meeting-id']) and !empty($_GET['meeting-id'])) {
      include_once 'partials/in_room.php';
    } else {
      include_once 'partials/landing.php';
    }
  ?>
</main>

<?php include 'footer-vidchat.php';