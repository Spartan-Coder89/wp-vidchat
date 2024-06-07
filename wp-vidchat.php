<?php

/**
 * @package WPVidChat
 * @version 0.3
 */
/*
Plugin Name: WP Vidchat
Plugin URI: https://simonjiloma.com
Description: Peer to peer, private and secure video chat application
Author: Simon Jiloma
Version: 0.3
Author URI: https://simonjiloma.com
*/

if (!defined('ABSPATH')) {
  die;
}

class WPVidChat 
{

  public function __construct() {

    add_action('init', function() {

      // Delete rooms that are past time limit
      $this->room_cleanup();

      if (is_null(get_page_by_path('vidchat'))) {

        $page_id = wp_insert_post([
          'post_title'    => 'Vidchat',
          'post_content'  => '',
          'post_status'   => 'publish',
          'post_author'   => 1,
          'post_type'     => 'page',
          'post_name'     => 'vidchat'
        ]);

        update_post_meta($page_id, '_wp_page_template', plugin_dir_path( __DIR__ ) . 'wp-vidchat/templates/vidchat.php');
      }

      add_action('wp_enqueue_scripts', function() {

        if (is_page('vidchat')) {

          wp_register_script( 'vidchat_peerjs', 'https://unpkg.com/peerjs@1.5.2/dist/peerjs.min.js', [], null, ['strategy' => 'defer']);
          wp_enqueue_script('vidchat_peerjs');

          wp_register_script( 'vidchat_alpinejs', 'https://cdn.jsdelivr.net/npm/alpinejs@3.13.10/dist/cdn.min.js', [], null, ['strategy' => 'defer']);
          wp_enqueue_script('vidchat_alpinejs');

          wp_enqueue_script('vidchat_main', plugins_url('wp-vidchat/assets/js/main.js' , __DIR__), [], '0.1', true );
          wp_localize_script('vidchat_main', 'vidchat_main', ['site_url' => get_site_url()]);

          wp_enqueue_style( 'vidchat_landing', plugins_url('wp-vidchat/assets/css/landing.css' , __DIR__), [], '0.1');

          if (isset($_GET['meeting-id']) and !empty($_GET['meeting-id'])) {
            wp_enqueue_style( 'vidchat_inroom', plugins_url('wp-vidchat/assets/css/in_room.css' , __DIR__), [], '0.1');
          }
        }
      });

    });

    add_filter('template_include', function($template) {

      if (is_page('vidchat')) {
        $template = plugin_dir_path( __DIR__ ) . 'wp-vidchat/templates/vidchat.php';
      }

      return $template;
    });

    add_action('template_redirect', function() {

      if (isset($_GET['meeting-id']) and !empty($_GET['meeting-id'])) {

        //  Check browser support
        if (!$this->check_browser_support()) {
          wp_safe_redirect(get_site_url() .'/vidchat?error='. urlencode('The current version of your browser is not supported to use the video chat application. Please update your browser.'));
          exit;
        }

        $room_check = $this->check_room_exists($_GET['meeting-id']);

        //  Check if room exists
        if (!$room_check) {
          wp_safe_redirect(get_site_url() .'/vidchat?error='. urlencode('Meeting room does not exist. Either you have the wrong link or this meeting room is expired. Meeting rooms are valid for 12 hours only. Please check your link if this room is not yet past its expiration.'));
          exit;
        }
      }
    });

    add_action('rest_api_init', function() {
      
      register_rest_route('vidchat/v1', '/check-room', array(
        'methods' => 'GET',
        'permission_callback' => '__return_true',
        'callback' => array($this, 'check_room')
      ));

      register_rest_route('vidchat/v1', '/create-meeting', array(
        'methods' => 'POST',
        'permission_callback' => '__return_true',
        'callback' => array($this, 'create_meeting')
      ));

      register_rest_route('vidchat/v1', '/join-meeting', array(
        'methods' => 'POST',
        'permission_callback' => '__return_true',
        'callback' => array($this, 'join_meeting')
      ));

      register_rest_route('vidchat/v1', '/remove-participant', array(
        'methods' => 'POST',
        'permission_callback' => '__return_true',
        'callback' => array($this, 'remove_participant')
      ));

      register_rest_route('vidchat/v1', '/invite-participant', array(
        'methods' => 'POST',
        'permission_callback' => '__return_true',
        'callback' => array($this, 'invite_participant')
      ));

    });
    
  }

  public function check_room( WP_REST_Request $request ) {

    if (!isset($request['room_id']) or empty($request['room_id'])) {
      
      header('Content-Type: application/json');
      echo wp_json_encode([
        'status' => 'success',
        'room_exists' => false,
        'return' => 1,
        'room_id' => $request['room_id']
      ]);
      exit;
    }

    $vidchat = get_option('vidchat');

    if (isset($vidchat[$request['room_id']])) {

      header('Content-Type: application/json');
      echo wp_json_encode([
        'status' => 'success',
        'room_exists' => true,
        'return' => 2,
        'room_id' => $request['room_id']
      ]);
      exit;

    } else {

      header('Content-Type: application/json');
      echo wp_json_encode([
        'status' => 'success',
        'room_exists' => false,
        'return' => 3,
        'room_id' => $request['room_id']
      ]);
      exit;
    }
  }

  public function create_meeting( WP_REST_Request $request ) {

    if (!isset($request['meeting_id']) or empty($request['meeting_id'])) {
      
      header('Content-Type: application/json');
      echo wp_json_encode([
        'status' => 'error',
        'error_message' => 'Meeting ID not found'
      ]);
      exit;
    }

    global $wpdb;
    $meeting_id = $request['meeting_id'];

    $result = $wpdb->insert(
      $wpdb->prefix . 'vidchat_meeting_rooms',
      [
        'meeting_id' => $meeting_id,
        'date_created' => date('Y-m-d H:i:s')
      ]
    );

    header('Content-Type: application/json');

    if ($result !== false) {
      echo wp_json_encode(['status' => 'success']);
      exit;
    
    } else {
      echo wp_json_encode([
        'status' => 'error',
        'error_message' => 'Something went wrong in saving your meeting id'
      ]);
    }
  }

  public function join_meeting( WP_REST_Request $request ) {

    if (!isset($request['my_participant_id']) or empty($request['my_participant_id'])) {

      header('Content-Type: application/json');
      echo wp_json_encode([
        'status' => 'error',
        'error_message' => 'Your participant ID is required'
      ]);
      exit;
    }

    if (!isset($request['my_peer_id']) or empty($request['my_peer_id'])) {

      header('Content-Type: application/json');
      echo wp_json_encode([
        'status' => 'error',
        'error_message' => 'Your Peer ID is required'
      ]);
      exit;
    }

    if (!isset($request['meeting_id']) or empty($request['meeting_id'])) {

      header('Content-Type: application/json');
      echo wp_json_encode([
        'status' => 'error',
        'error_message' => 'Meeting ID is required'
      ]);
      exit;
    }

    $peer_id = $request['my_peer_id'];
    $participant_id = $request['my_participant_id'];
    $meeting_id = $request['meeting_id'];

    global $wpdb;

    $tablename = $wpdb->prefix . 'vidchat_peers';
    $check_peer_existing = $wpdb->get_row("SELECT participant_id FROM $tablename WHERE participant_id = '$participant_id'");
    
    //  Update or insert peer
    if (isset($check_peer_existing->participant_id)) {
      $results = $wpdb->update($tablename, 
      [
        'peer_id' => $peer_id,
        'meeting_id' => $meeting_id
      ], 
      ['participant_id' => $participant_id]);

    } else {
      $results = $wpdb->insert($tablename, [
        'participant_id' => $participant_id, 
        'peer_id' => $peer_id,
        'meeting_id' => $meeting_id
      ]);
    }

    //  Get all peers
    $return_peers = [];
    $all_peers = $wpdb->get_results("SELECT * FROM $tablename WHERE meeting_id = '$meeting_id'", ARRAY_A);

    if (!is_null($all_peers)) {
      foreach ($all_peers as $key => $peer) {
        if ($peer['peer_id'] !== $peer_id) {
          $return_peers[$peer['participant_id']] = $peer['peer_id'];
        }
      }
    }

    header('Content-Type: application/json');

    if ($results !== false) {
      echo wp_json_encode([ 
        'status' => 'success',
        'my_peers' => $return_peers
      ]);

    } else {
      echo wp_json_encode([
        'status' => 'error',
        'error_message' => 'Cannot save your peer id'
      ]);
    }

    exit;
  }

  public function remove_participant( WP_REST_Request $request ) {

    if (!isset($request['my_participant_id']) or empty($request['my_participant_id'])) {

      header('Content-Type: application/json');
      echo wp_json_encode([
        'status' => 'error',
        'error_message' => 'Your participant ID is required'
      ]);
      exit;
    }

    global $wpdb;
    $participant_id = $request['my_participant_id'];
    $tablename = $wpdb->prefix . 'vidchat_peers';

    $delete_participant = $wpdb->delete($tablename, ['participant_id' => $participant_id]);

    header('Content-Type: application/json');

    if ($delete_participant !== false) {
      echo wp_json_encode([ 'status' => 'success' ]);
    } else {
      echo wp_json_encode([ 'status' => 'error', 'error_message' => 'Cannot remove your peer id.' ]);
    }

    exit;
  }

  public function invite_participant( WP_REST_Request $request ) {

    if (!isset($request['meeting_id']) or empty($request['meeting_id'])) {
      
      header('Content-Type: application/json');
      echo wp_json_encode([
        'status' => 'error',
        'error_message' => 'Meeting ID name required.'
      ]);
      exit;
    }

    if (!isset($request['participant_name']) or empty($request['participant_name'])) {
      
      header('Content-Type: application/json');
      echo wp_json_encode([
        'status' => 'error',
        'error_message' => 'Participant name required.'
      ]);
      exit;
    }

    if (!isset($request['recipient']) or empty($request['recipient'])) {
      
      header('Content-Type: application/json');
      echo wp_json_encode([
        'status' => 'error',
        'error_message' => 'Recipient email required.'
      ]);
      exit;
    }

    $meeting_id = $request['meeting_id'];
    $participant_name = $request['participant_name'];
    $to = $request['recipient'];
    $subject = 'You are invited to join.';

    $headers = 'From: '. get_option('blogname') .' <'. get_option('admin_email') .'>'."\r\n";
    $headers .= "Content-Type: text/html; charset=UTF-8\r\n";

    $message = '
    <table style="max-width:480px;width:100%;border:1px solid #E3EEFF;border-radius:10px;padding:30px;">
      <tbody>
        <tr>
          <td>
            <svg id="logo" width="210" height="34" viewbox="0 0 210 34" fill="none" xmlns="http://www.w3.org/2000/svg" style="margin-bottom:30px;">
              <path d="M26.9864 16.2557C26.9864 22.1588 22.1935 26.9443 16.2811 26.9443C10.3687 26.9443 5.57572 22.1588 5.57572 16.2557C5.57572 10.3525 10.3687 5.56701 16.2811 5.56701C22.1935 5.56701 26.9864 10.3525 26.9864 16.2557Z" fill="white"></path>
              <path fill-rule="evenodd" clip-rule="evenodd" d="M33.4542 16.701C33.4542 25.925 25.9655 33.402 16.7271 33.402C14.0508 33.402 11.5216 32.7741 9.28021 31.6584C8.68812 31.3529 8.00461 31.2739 7.35827 31.4363L3.63482 32.4317C3.26627 32.5299 2.87834 32.5296 2.50997 32.4307C2.14159 32.3319 1.80573 32.1381 1.53609 31.8687C1.26646 31.5993 1.07254 31.2639 0.973797 30.896C0.875055 30.5281 0.874965 30.1408 0.973538 29.7729L1.9688 26.0553C2.13068 25.4102 2.05097 24.7284 1.74466 24.138C0.593217 21.8277 -0.00407356 19.2816 2.09095e-05 16.701C2.09095e-05 7.47705 7.48874 0 16.7271 0C25.9655 0 33.4542 7.47705 33.4542 16.701ZM23.4179 16.701C23.4179 15.2914 21.8673 14.3395 18.7678 12.4372C15.6231 10.5083 14.0508 9.54463 12.8799 10.2528C11.709 10.9609 11.709 12.8748 11.709 16.701C11.709 20.5272 11.709 22.4412 12.8799 23.1493C14.0524 23.8574 15.6231 22.8938 18.7678 20.9648C21.8673 19.0625 23.4179 18.1106 23.4179 16.701Z" fill="#0062FF"></path>
              <path d="M50.3026 26.2246C48.704 26.2246 47.2671 25.9301 45.9919 25.341C44.7168 24.752 43.6986 23.8874 42.9374 22.7472C42.1951 21.5881 41.824 20.1915 41.824 18.5573C41.824 17.4172 42.0238 16.182 42.4235 14.8519C43.299 12.0016 44.6217 9.94935 46.3916 8.69522C48.1616 7.42208 50.0552 6.78551 52.0726 6.78551C53.1574 6.78551 54.1185 6.94703 54.9559 7.27006C55.7933 7.5931 56.5641 8.05865 57.2682 8.66672L58.039 8.06815C58.5529 7.66911 58.9811 7.39358 59.3237 7.24156C59.6853 7.08955 60.0849 7.01354 60.5227 7.01354C60.9985 7.01354 61.3791 7.11805 61.6646 7.32707C61.95 7.53609 62.0928 7.84013 62.0928 8.23917C62.0928 8.44819 62.0547 8.65721 61.9786 8.86624L60.3799 13.3127C60.2086 13.8258 59.9993 14.1868 59.7519 14.3958C59.5235 14.6049 59.1714 14.7094 58.6956 14.7094C58.2008 14.7094 57.7916 14.5383 57.4681 14.1963C57.1636 13.8353 56.8115 13.2272 56.4118 12.3721C55.955 11.479 55.5839 10.89 55.2985 10.6049C55.013 10.3199 54.5943 10.1774 54.0424 10.1774C53.2621 10.1774 52.5103 10.6619 51.7871 11.631C51.0639 12.5811 50.4073 14.0158 49.8173 15.935C49.3225 17.5502 49.0751 18.8993 49.0751 19.9824C49.0751 20.9325 49.2559 21.6451 49.6175 22.1202C49.9791 22.5762 50.4644 22.8042 51.0734 22.8042C51.9679 22.8042 52.7006 22.6047 53.2716 22.2057C53.8616 21.8066 54.4611 21.2651 55.0701 20.581C55.4507 20.163 55.7552 19.8589 55.9836 19.6689C56.231 19.4599 56.4879 19.3554 56.7544 19.3554C57.097 19.3554 57.4585 19.5264 57.8392 19.8684C58.2198 20.2105 58.4006 20.5525 58.3816 20.8945C58.4006 21.3126 58.0581 21.9587 57.3539 22.8327C56.6687 23.7068 55.7076 24.4954 54.4706 25.1985C53.2525 25.8826 51.8632 26.2246 50.3026 26.2246Z" fill="#0062FF"></path>
              <path d="M77.6336 22.1202C77.5955 22.1962 77.5765 22.3102 77.5765 22.4622C77.5765 22.5952 77.605 22.6997 77.6621 22.7757C77.7383 22.8517 77.8334 22.8897 77.9476 22.8897C78.176 22.8897 78.3663 22.7947 78.5186 22.6047C78.6898 22.3957 78.804 22.2912 78.8611 22.2912C78.9563 22.2912 79.0324 22.3577 79.0895 22.4907C79.1466 22.6047 79.1752 22.7472 79.1752 22.9183C79.1942 23.4693 79.0134 24.0109 78.6328 24.5429C78.2521 25.056 77.6907 25.4835 76.9484 25.8256C76.2252 26.1486 75.3498 26.3101 74.3221 26.3101C73.066 26.3101 72.0668 26.0251 71.3246 25.455C70.5823 24.866 70.2017 24.0869 70.1827 23.1178C70.1827 22.4147 70.354 21.6261 70.6965 20.752L72.2666 16.6476C72.3618 16.4005 72.4094 16.201 72.4094 16.049C72.4094 15.802 72.3237 15.612 72.1525 15.4789C72.0002 15.3269 71.8099 15.2509 71.5815 15.2509C71.2199 15.2509 70.8488 15.4219 70.4681 15.764C70.1065 16.087 69.8116 16.6191 69.5832 17.3602V17.3031L67.7847 23.0893C67.7276 23.3173 67.699 23.5168 67.699 23.6878C67.699 23.9349 67.7466 24.1344 67.8418 24.2864C67.9369 24.4194 68.0702 24.5524 68.2414 24.6854C68.3747 24.8185 68.4698 24.9325 68.5269 25.0275C68.584 25.1035 68.5935 25.208 68.5555 25.341C68.4603 25.588 68.27 25.7686 67.9845 25.8826C67.699 25.9966 67.2613 26.0536 66.6713 26.0536H60.1625C59.6676 26.0536 59.306 25.9776 59.0777 25.8256C58.8493 25.6545 58.7732 25.436 58.8493 25.17C58.9254 24.942 59.1252 24.7424 59.4488 24.5714C59.7343 24.4194 59.9721 24.2389 60.1625 24.0299C60.3528 23.8208 60.5146 23.4883 60.6478 23.0323L64.987 8.80923C65.0441 8.63821 65.0727 8.4957 65.0727 8.38169C65.0727 8.17266 65.0156 8.00164 64.9014 7.86863C64.8062 7.73562 64.673 7.6026 64.5017 7.46959C64.3114 7.31757 64.1686 7.18456 64.0735 7.07054C63.9974 6.95653 63.9878 6.80451 64.0449 6.61449C64.1591 6.17745 64.7586 5.79741 65.8434 5.47437C66.9282 5.15134 68.0606 4.98982 69.2406 4.98982C70.3444 4.98982 71.1533 5.19884 71.6671 5.61689C72.2 6.03493 72.4665 6.60499 72.4665 7.32707C72.4665 7.74512 72.3999 8.15366 72.2666 8.5527L70.7251 13.5692C71.4673 12.6001 72.2476 11.9256 73.066 11.5455C73.9034 11.1655 74.8074 10.9755 75.778 10.9755C76.9389 10.9755 77.8715 11.327 78.5757 12.0301C79.2989 12.7332 79.6605 13.6453 79.6605 14.7664C79.6605 15.3554 79.5653 15.935 79.375 16.5051L77.6336 22.1202Z" fill="#0062FF"></path>
              <path d="M87.9096 10.9755C89.0134 10.9755 89.8223 11.1845 90.3361 11.6025C90.85 12.0206 91.1069 12.5906 91.1069 13.3127C91.1069 13.7498 91.0403 14.1678 90.9071 14.5669L88.2807 23.0893C88.2236 23.3173 88.1951 23.5168 88.1951 23.6878C88.1951 23.9349 88.2427 24.1344 88.3378 24.2864C88.433 24.4194 88.5662 24.5524 88.7375 24.6854C88.8707 24.8185 88.9659 24.9325 89.0229 25.0275C89.08 25.1035 89.0896 25.208 89.0515 25.341C88.9563 25.588 88.766 25.7686 88.4805 25.8826C88.1951 25.9966 87.7573 26.0536 87.1674 26.0536H80.6585C80.1637 26.0536 79.8021 25.9776 79.5737 25.8256C79.3453 25.6545 79.2692 25.436 79.3453 25.17C79.4215 24.942 79.6213 24.7424 79.9448 24.5714C80.2303 24.4194 80.4682 24.2389 80.6585 24.0299C80.8488 23.8208 81.0106 23.4883 81.1438 23.0323L83.6275 14.7949C83.6846 14.6239 83.7131 14.4813 83.7131 14.3673C83.7131 14.1583 83.6655 13.9968 83.5704 13.8828C83.4752 13.7498 83.3325 13.6167 83.1422 13.4837C82.9518 13.3317 82.8186 13.1987 82.7425 13.0847C82.6664 12.9707 82.6568 12.8187 82.7139 12.6286C82.8281 12.1916 83.4276 11.8116 84.5124 11.4885C85.5972 11.1465 86.7296 10.9755 87.9096 10.9755ZM89.8223 4.67628C90.5645 4.67628 91.183 4.92331 91.6779 5.41737C92.1727 5.89242 92.4201 6.48148 92.4201 7.18455C92.4201 7.67861 92.2869 8.16316 92.0204 8.63821C91.773 9.11326 91.4114 9.50281 90.9356 9.80684C90.4789 10.0919 89.965 10.2344 89.3941 10.2344C88.6709 10.2344 88.0619 9.99686 87.567 9.52181C87.0912 9.02775 86.8438 8.41969 86.8248 7.69761C86.8248 7.22256 86.9485 6.75701 87.1959 6.30096C87.4433 5.82591 87.7954 5.43637 88.2522 5.13233C88.7089 4.8283 89.2323 4.67628 89.8223 4.67628Z" fill="#0062FF"></path>
              <path d="M103.617 11.346C103.978 11.346 104.254 11.422 104.445 11.574C104.654 11.726 104.759 11.9351 104.759 12.2011C104.759 12.2771 104.74 12.4101 104.702 12.6001C104.454 13.4362 103.883 13.8543 102.989 13.8543H101.333L99.1919 20.8945C99.0968 21.1796 99.0492 21.4741 99.0492 21.7781C99.0492 22.1202 99.1443 22.3577 99.3347 22.4907C99.525 22.6237 99.7914 22.6902 100.134 22.6902C100.438 22.6902 100.819 22.6522 101.276 22.5762C101.504 22.5192 101.704 22.4907 101.875 22.4907C102.009 22.4907 102.104 22.5382 102.161 22.6332C102.237 22.7092 102.275 22.8137 102.275 22.9468C102.294 23.3268 102.009 23.7923 101.419 24.3434C100.848 24.8755 100.067 25.341 99.0777 25.7401C98.0881 26.1201 96.9938 26.3101 95.7948 26.3101C94.5006 26.3101 93.4634 26.0156 92.6831 25.4265C91.9028 24.8375 91.5126 24.0299 91.5126 23.0038C91.5126 22.5287 91.5887 22.0727 91.741 21.6356L93.568 15.992C93.6632 15.669 93.7108 15.4124 93.7108 15.2224C93.7108 14.8424 93.6156 14.5193 93.4253 14.2533C93.254 13.9873 93.0066 13.7118 92.6831 13.4267C92.3976 13.1607 92.1978 12.9422 92.0836 12.7712C91.9694 12.5811 91.9408 12.3626 91.9979 12.1156C92.074 11.8686 92.2358 11.6785 92.4832 11.5455C92.7306 11.4125 93.1208 11.346 93.6537 11.346H95.2523L97.0508 9.55031C97.6789 8.92324 98.2498 8.4862 98.7637 8.23917C99.2966 7.99214 99.9817 7.86863 100.819 7.86863C102.018 7.86863 102.618 8.32468 102.618 9.23678C102.618 9.52181 102.58 9.78784 102.503 10.0349L102.104 11.346H103.617Z" fill="#0062FF"></path>
              <path d="M114.462 11.346C114.823 11.346 115.099 11.422 115.289 11.574C115.499 11.726 115.603 11.9351 115.603 12.2011C115.603 12.2771 115.584 12.4101 115.546 12.6001C115.299 13.4362 114.728 13.8543 113.833 13.8543H112.178L110.037 20.8945C109.941 21.1796 109.894 21.4741 109.894 21.7781C109.894 22.1202 109.989 22.3577 110.179 22.4907C110.37 22.6237 110.636 22.6902 110.979 22.6902C111.283 22.6902 111.664 22.6522 112.121 22.5762C112.349 22.5192 112.549 22.4907 112.72 22.4907C112.853 22.4907 112.949 22.5382 113.006 22.6332C113.082 22.7092 113.12 22.8137 113.12 22.9468C113.139 23.3268 112.853 23.7923 112.263 24.3434C111.692 24.8755 110.912 25.341 109.922 25.7401C108.933 26.1201 107.838 26.3101 106.639 26.3101C105.345 26.3101 104.308 26.0156 103.528 25.4265C102.748 24.8375 102.357 24.0299 102.357 23.0038C102.357 22.5287 102.433 22.0727 102.586 21.6356L104.413 15.992C104.508 15.669 104.556 15.4124 104.556 15.2224C104.556 14.8424 104.46 14.5193 104.27 14.2533C104.099 13.9873 103.851 13.7118 103.528 13.4267C103.242 13.1607 103.042 12.9422 102.928 12.7712C102.814 12.5811 102.786 12.3626 102.843 12.1156C102.919 11.8686 103.081 11.6785 103.328 11.5455C103.575 11.4125 103.966 11.346 104.498 11.346H106.097L107.896 9.55031C108.524 8.92324 109.095 8.4862 109.608 8.23917C110.141 7.99214 110.826 7.86863 111.664 7.86863C112.863 7.86863 113.462 8.32468 113.462 9.23678C113.462 9.52181 113.424 9.78784 113.348 10.0349L112.949 11.346H114.462Z" fill="#0062FF"></path>
              <path d="M129.098 10.9755C129.935 10.9755 130.601 11.3175 131.096 12.0016C131.61 12.6666 131.867 13.5787 131.867 14.7379C131.867 15.745 131.686 16.8281 131.324 17.9872C130.62 20.3245 129.488 22.5287 127.927 24.5999C126.385 26.6712 124.606 28.3338 122.589 29.588C120.59 30.8421 118.592 31.4692 116.594 31.4692C115.604 31.4692 114.748 31.2982 114.024 30.9561C113.32 30.6141 112.787 30.158 112.426 29.588C112.045 29.0179 111.855 28.4098 111.855 27.7638C111.855 27.4787 111.902 27.1652 111.997 26.8232C112.169 26.2911 112.454 25.8826 112.854 25.5975C113.254 25.3125 113.729 25.17 114.281 25.17C115.157 25.17 115.87 25.4645 116.422 26.0536C116.993 26.6617 117.355 27.4882 117.507 28.5334C118.725 28.4764 119.848 27.9538 120.876 26.9657C119.905 26.7947 119.182 26.4716 118.706 25.9966C118.249 25.5025 117.935 24.7425 117.764 23.7163L116.622 16.7331C116.565 16.372 116.479 16.125 116.365 15.992C116.27 15.84 116.137 15.764 115.966 15.764C115.832 15.764 115.671 15.8305 115.48 15.9635C115.309 16.0965 115.185 16.163 115.109 16.163C114.957 16.163 114.881 16.0015 114.881 15.6785C114.881 15.4124 114.928 15.1274 115.024 14.8234C115.366 13.7403 116.004 12.8282 116.936 12.0871C117.869 11.327 118.954 10.947 120.191 10.947C121.409 10.947 122.303 11.308 122.874 12.0301C123.464 12.7522 123.845 13.8638 124.016 15.3649L124.872 21.6356C124.93 22.1107 125.101 22.3482 125.386 22.3482C125.729 22.3482 126.129 22.0442 126.585 21.4361C127.042 20.809 127.489 19.9254 127.927 18.7853C127.356 18.2723 126.918 17.6832 126.614 17.0181C126.309 16.353 126.157 15.6405 126.157 14.8804C126.157 14.2913 126.233 13.7593 126.385 13.2842C126.614 12.5241 126.966 11.9541 127.442 11.574C127.937 11.175 128.488 10.9755 129.098 10.9755Z" fill="#0062FF"></path>
              <path d="M147.32 26.2246C145.721 26.2246 144.284 25.9301 143.009 25.341C141.734 24.752 140.716 23.8874 139.954 22.7472C139.212 21.5881 138.841 20.1915 138.841 18.5573C138.841 17.4172 139.041 16.182 139.441 14.8519C140.316 12.0016 141.639 9.94935 143.409 8.69522C145.179 7.42208 147.072 6.78551 149.09 6.78551C150.175 6.78551 151.136 6.94703 151.973 7.27006C152.81 7.5931 153.581 8.05865 154.285 8.66672L155.056 8.06815C155.57 7.66911 155.998 7.39358 156.341 7.24156C156.702 7.08955 157.102 7.01354 157.54 7.01354C158.016 7.01354 158.396 7.11805 158.682 7.32707C158.967 7.53609 159.11 7.84013 159.11 8.23917C159.11 8.44819 159.072 8.65721 158.996 8.86624L157.397 13.3127C157.226 13.8258 157.016 14.1868 156.769 14.3958C156.541 14.6049 156.189 14.7094 155.713 14.7094C155.218 14.7094 154.809 14.5383 154.485 14.1963C154.181 13.8353 153.829 13.2272 153.429 12.3721C152.972 11.479 152.601 10.89 152.316 10.6049C152.03 10.3199 151.611 10.1774 151.06 10.1774C150.279 10.1774 149.527 10.6619 148.804 11.631C148.081 12.5811 147.424 14.0158 146.834 15.935C146.34 17.5502 146.092 18.8993 146.092 19.9824C146.092 20.9325 146.273 21.6451 146.635 22.1202C146.996 22.5762 147.482 22.8042 148.091 22.8042C148.985 22.8042 149.718 22.6047 150.289 22.2057C150.879 21.8066 151.478 21.2651 152.087 20.581C152.468 20.163 152.772 19.8589 153.001 19.6689C153.248 19.4599 153.505 19.3554 153.772 19.3554C154.114 19.3554 154.476 19.5264 154.856 19.8684C155.237 20.2105 155.418 20.5525 155.399 20.8945C155.418 21.3126 155.075 21.9587 154.371 22.8327C153.686 23.7068 152.725 24.4954 151.488 25.1985C150.27 25.8826 148.88 26.2246 147.32 26.2246Z" fill="#0062FF"></path>
              <path d="M174.651 22.1202C174.613 22.1962 174.594 22.3102 174.594 22.4622C174.594 22.5952 174.622 22.6997 174.679 22.7757C174.755 22.8517 174.851 22.8897 174.965 22.8897C175.193 22.8897 175.383 22.7947 175.536 22.6047C175.707 22.3957 175.821 22.2912 175.878 22.2912C175.973 22.2912 176.05 22.3577 176.107 22.4907C176.164 22.6047 176.192 22.7472 176.192 22.9183C176.211 23.4693 176.031 24.0109 175.65 24.5429C175.269 25.056 174.708 25.4835 173.966 25.8256C173.242 26.1486 172.367 26.3101 171.339 26.3101C170.083 26.3101 169.084 26.0251 168.342 25.455C167.599 24.866 167.219 24.0869 167.2 23.1178C167.2 22.4147 167.371 21.6261 167.714 20.752L169.284 16.6476C169.379 16.4005 169.427 16.201 169.427 16.049C169.427 15.802 169.341 15.612 169.17 15.4789C169.017 15.3269 168.827 15.2509 168.599 15.2509C168.237 15.2509 167.866 15.4219 167.485 15.764C167.124 16.087 166.829 16.6191 166.6 17.3602V17.3031L164.802 23.0893C164.745 23.3173 164.716 23.5168 164.716 23.6878C164.716 23.9349 164.764 24.1344 164.859 24.2864C164.954 24.4194 165.087 24.5524 165.259 24.6854C165.392 24.8185 165.487 24.9325 165.544 25.0275C165.601 25.1035 165.611 25.208 165.573 25.341C165.477 25.588 165.287 25.7686 165.002 25.8826C164.716 25.9966 164.278 26.0536 163.688 26.0536H157.18C156.685 26.0536 156.323 25.9776 156.095 25.8256C155.866 25.6545 155.79 25.436 155.866 25.17C155.943 24.942 156.142 24.7424 156.466 24.5714C156.751 24.4194 156.989 24.2389 157.18 24.0299C157.37 23.8208 157.532 23.4883 157.665 23.0323L162.004 8.80923C162.061 8.63821 162.09 8.4957 162.09 8.38169C162.09 8.17266 162.033 8.00164 161.919 7.86863C161.823 7.73562 161.69 7.6026 161.519 7.46959C161.329 7.31757 161.186 7.18456 161.091 7.07054C161.015 6.95653 161.005 6.80451 161.062 6.61449C161.176 6.17745 161.776 5.79741 162.861 5.47437C163.945 5.15134 165.078 4.98982 166.258 4.98982C167.362 4.98982 168.17 5.19884 168.684 5.61689C169.217 6.03493 169.484 6.60499 169.484 7.32707C169.484 7.74512 169.417 8.15366 169.284 8.5527L167.742 13.5692C168.484 12.6001 169.265 11.9256 170.083 11.5455C170.921 11.1655 171.825 10.9755 172.795 10.9755C173.956 10.9755 174.889 11.327 175.593 12.0301C176.316 12.7332 176.678 13.6453 176.678 14.7664C176.678 15.3554 176.582 15.935 176.392 16.5051L174.651 22.1202Z" fill="#0062FF"></path>
              <path d="M187.61 10.9755C189.799 10.9755 191.55 11.384 192.863 12.2011C194.176 12.9992 194.833 14.2248 194.833 15.878C194.833 16.5051 194.719 17.2176 194.49 18.0157L193.32 21.9491C193.301 22.0252 193.291 22.1202 193.291 22.2342C193.291 22.5382 193.415 22.6902 193.662 22.6902C193.891 22.6902 194.081 22.5952 194.233 22.4052C194.405 22.1962 194.519 22.0917 194.576 22.0917C194.671 22.0917 194.747 22.1582 194.804 22.2912C194.88 22.4242 194.918 22.5762 194.918 22.7472C194.937 23.2603 194.738 23.7828 194.319 24.3149C193.919 24.847 193.377 25.284 192.692 25.626C192.007 25.9681 191.255 26.1391 190.436 26.1391C189.447 26.1391 188.6 25.9586 187.896 25.5975C187.192 25.2365 186.706 24.7044 186.44 24.0014C185.869 24.6854 185.193 25.2175 184.413 25.5975C183.633 25.9586 182.795 26.1391 181.901 26.1391C180.892 26.1391 180.045 25.9491 179.36 25.569C178.675 25.17 178.161 24.6664 177.818 24.0584C177.495 23.4313 177.333 22.7757 177.333 22.0917C177.333 21.7876 177.362 21.4931 177.419 21.2081C177.723 19.8969 178.38 18.9088 179.389 18.2437C180.416 17.5787 181.634 17.2461 183.043 17.2461C184.622 17.2461 186.173 17.4932 187.696 17.9872L188.41 16.106C188.657 15.3079 188.781 14.6904 188.781 14.2533C188.762 13.7973 188.609 13.4552 188.324 13.2272C188.038 12.9992 187.601 12.8852 187.011 12.8852C187.125 13.1892 187.182 13.5027 187.182 13.8258C187.182 14.5288 186.916 15.1369 186.383 15.65C185.85 16.163 185.089 16.4196 184.099 16.4196C183.166 16.4196 182.434 16.22 181.901 15.821C181.387 15.4029 181.13 14.8899 181.13 14.2818C181.13 13.3317 181.663 12.5431 182.729 11.9161C183.794 11.289 185.422 10.9755 187.61 10.9755ZM186.012 19.6119C185.479 19.6119 185.041 19.8209 184.698 20.239C184.375 20.638 184.213 21.0751 184.213 21.5501C184.213 21.8541 184.28 22.1012 184.413 22.2912C184.565 22.4812 184.774 22.5762 185.041 22.5762C185.288 22.5762 185.555 22.4812 185.84 22.2912C186.145 22.0822 186.364 21.7781 186.497 21.3791L187.096 19.6974C186.773 19.6404 186.411 19.6119 186.012 19.6119Z" fill="#0062FF"></path>
              <path d="M208.858 11.346C209.22 11.346 209.496 11.422 209.686 11.574C209.895 11.726 210 11.9351 210 12.2011C210 12.2771 209.981 12.4101 209.943 12.6001C209.695 13.4362 209.125 13.8543 208.23 13.8543H206.574L204.433 20.8945C204.338 21.1796 204.29 21.4741 204.29 21.7781C204.29 22.1202 204.386 22.3577 204.576 22.4907C204.766 22.6237 205.033 22.6902 205.375 22.6902C205.68 22.6902 206.06 22.6522 206.517 22.5762C206.746 22.5192 206.945 22.4907 207.117 22.4907C207.25 22.4907 207.345 22.5382 207.402 22.6332C207.478 22.7092 207.516 22.8137 207.516 22.9468C207.535 23.3268 207.25 23.7923 206.66 24.3434C206.089 24.8755 205.309 25.341 204.319 25.7401C203.329 26.1201 202.235 26.3101 201.036 26.3101C199.742 26.3101 198.705 26.0156 197.924 25.4265C197.144 24.8375 196.754 24.0299 196.754 23.0038C196.754 22.5287 196.83 22.0727 196.982 21.6356L198.809 15.992C198.904 15.669 198.952 15.4124 198.952 15.2224C198.952 14.8424 198.857 14.5193 198.667 14.2533C198.495 13.9873 198.248 13.7118 197.924 13.4267C197.639 13.1607 197.439 12.9422 197.325 12.7712C197.211 12.5811 197.182 12.3626 197.239 12.1156C197.315 11.8686 197.477 11.6785 197.725 11.5455C197.972 11.4125 198.362 11.346 198.895 11.346H200.494L202.292 9.55031C202.92 8.92324 203.491 8.4862 204.005 8.23917C204.538 7.99214 205.223 7.86863 206.06 7.86863C207.259 7.86863 207.859 8.32468 207.859 9.23678C207.859 9.52181 207.821 9.78784 207.745 10.0349L207.345 11.346H208.858Z" fill="#0062FF"></path>
            </svg>
          </td>
        </tr>
        <tr>
          <td>
            <p id="greetings" style="margin-bottom:15px;line-height:140%;font-family:"Poppins", Arial, Helvetica, sans-serif;font-size:16px;">Hello '. $to .',</p>
            <p id="body" style="margin-bottom:30px;line-height:140%;font-family:"Poppins", Arial, Helvetica, sans-serif;font-size:16px;">'. $participant_name .' is inviting you for a video chat right now. Just click the button below to join the session right from your browser.</p>
            <a id="link_button" href="'. get_site_url() .'/vidchat?meeting-id='. $meeting_id .'" style="display:flex;align-items:center;justify-content:center;background-color:#004CC6;max-width:215px;width:100%;padding:10px;font-family:"Poppins", Arial, Helvetica, sans-serif;font-weight:500;text-decoration:none;color:#fff;border-radius:5px;font-size:16px;margin-bottom:30px;">
              <svg width="24" height="24" viewbox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="margin-right:10px;">
                <g clip-path="url(#clip0_484_116)">
                  <path fill-rule="evenodd" clip-rule="evenodd" d="M0 2.57143C0 1.88944 0.270918 1.23539 0.753154 0.753154C1.23539 0.270918 1.88944 0 2.57143 0L14.5714 0C15.2534 0 15.9075 0.270918 16.3897 0.753154C16.8719 1.23539 17.1429 1.88944 17.1429 2.57143V8.14286H16.2583C16.1779 7.50655 15.9207 6.90554 15.5158 6.40814C15.1109 5.91073 14.5746 5.53686 13.9678 5.32901C13.3611 5.12117 12.7082 5.08768 12.0834 5.23235C11.4585 5.37702 10.8868 5.69406 10.4331 6.14743L7.00457 9.576C6.36181 10.219 6.00073 11.0909 6.00073 12C6.00073 12.9091 6.36181 13.781 7.00457 14.424L10.4331 17.8526C10.8868 18.3059 11.4585 18.623 12.0834 18.7677C12.7082 18.9123 13.3611 18.8788 13.9678 18.671C14.5746 18.4631 15.1109 18.0893 15.5158 17.5919C15.9207 17.0945 16.1779 16.4935 16.2583 15.8571H17.1429V21.4286C17.1429 22.1106 16.8719 22.7646 16.3897 23.2468C15.9075 23.7291 15.2534 24 14.5714 24H2.57143C1.88944 24 1.23539 23.7291 0.753154 23.2468C0.270918 22.7646 0 22.1106 0 21.4286L0 2.57143ZM13.3491 7.38343C13.5841 7.48075 13.7849 7.64556 13.9262 7.85703C14.0675 8.06849 14.1429 8.31711 14.1429 8.57143V10.2857H22.2857C22.7404 10.2857 23.1764 10.4663 23.4979 10.7878C23.8194 11.1093 24 11.5453 24 12C24 12.4547 23.8194 12.8907 23.4979 13.2122C23.1764 13.5337 22.7404 13.7143 22.2857 13.7143H14.1429V15.4286C14.1426 15.6827 14.0671 15.9311 13.9258 16.1423C13.7845 16.3535 13.5838 16.5181 13.349 16.6154C13.1142 16.7126 12.8559 16.738 12.6066 16.6885C12.3574 16.639 12.1284 16.5167 11.9486 16.3371L8.52 12.9086C8.27923 12.6675 8.14399 12.3407 8.14399 12C8.14399 11.6593 8.27923 11.3325 8.52 11.0914L11.9486 7.66286C12.1283 7.48304 12.3572 7.36053 12.6065 7.31079C12.8558 7.26106 13.1142 7.28633 13.3491 7.38343Z" fill="#E3EEFF"></path>
                </g>
                <defs>
                  <clippath id="clip0_484_116">
                    <rect width="24" height="24" fill="white"></rect>
                  </clippath>
                </defs>
              </svg>
              <span>Join now</span>
            </a>
            <p id="note" style="font-size:16px;font-family:"Poppins", Arial, Helvetica, sans-serif;line-height:140%;">
              If the button above does not work try opening this link 
              <a href="'. get_site_url() .'/vidchat?meeting-id='. $meeting_id .'" style="text-decoration:none;font-weight:500;">'. get_site_url() .'/vidchat?meeting-id='. $meeting_id .'</a>
              in your browser.
            </p>
          </td>
        </tr>
      </tbody>
    </table>';

    $email_result = wp_mail($to, $subject, $message, $headers);

    if ($email_result) {

      header('Content-Type: application/json');
      echo wp_json_encode([
        'status' => 'success',
        'message' => 'Invitation sent.'
      ]);
      exit;

    } else {

      header('Content-Type: application/json');
      echo wp_json_encode([
        'status' => 'error',
        'error_message' => 'Something went wrong in sending your invite.'
      ]);
      exit;
    }
  }

  public function get_browser_version() {

    $user_agent = $_SERVER['HTTP_USER_AGENT'];
  
    // Define a list of browsers and their user-agent patterns
    $browsers = [
      'Firefox' => '/Firefox\/([0-9\.]+)/',
      'Chrome' => '/Chrome\/([0-9\.]+)/',
      'Safari' => '/Version\/([0-9\.]+).*Safari/',
      'Opera' => '/OPR\/([0-9\.]+)/',
      'Edge' => '/Edg\/([0-9\.]+)/',
      'IE' => '/MSIE ([0-9\.]+)|Trident\/.*rv:([0-9\.]+)/'
    ];
  
    foreach ($browsers as $browser => $pattern) {
      if (preg_match($pattern, $user_agent, $matches)) {
        return [
          'browser' => $browser, 
          'version' => isset($matches[1]) ? $matches[1] : $matches[2]
        ];
      }
    }
    
    return [
      'browser' => 'unknown', 
      'version' => 'unknown'
    ];
  }

  public function check_browser_support() {

    //  Minimum supported versions
    $supported_browsers_version = [
      'Chrome' => 60.0,
      'Firefox' => 60.0,
      'Safari' => 15.0,
      'Edge' => 20.0,
      'Opera' => 50.0
    ];
  
    $browser = $this->get_browser_version();
  
    if (array_key_exists($browser['browser'], $supported_browsers_version)) {
      $version = (float) $browser['version'];
      return $version >= $supported_browsers_version[$browser['browser']];
      
    } else {
      return false;
    }
  }

  public function room_cleanup() {

    $time_limit = 43200; // 12 hours
    $rooms_to_delete = [];

    global $wpdb;
    $tablename = $wpdb->prefix . 'vidchat_meeting_rooms';
    $rooms = $wpdb->get_results("SELECT * FROM $tablename", ARRAY_A);

    //  Collect rooms that need to be deleted
    foreach ($rooms as $key => $room) {

      $room_timestamp = strtotime($room['date_created']);
      $current_timestamp = time();
      $time_difference = $current_timestamp - $room_timestamp;

      if ($time_difference >= $time_limit) {
        $rooms_to_delete[] = $room['meeting_id'];
      }
    }

    //  Delete rooms and users in that room
    if (!empty($rooms_to_delete)) {
      foreach ($rooms_to_delete as $key => $meeting_id) {
        $wpdb->delete($wpdb->prefix . 'vidchat_meeting_rooms', ['meeting_id' => $meeting_id]);
        $wpdb->delete($wpdb->prefix . 'vidchat_peers', ['meeting_id' => $meeting_id]);
      }
    }
  }

  public function check_room_exists($meeting_id) {
    
    global $wpdb;

    $tablename = $wpdb->prefix . 'vidchat_meeting_rooms';
    $rows = $wpdb->get_row("SELECT meeting_id FROM $tablename WHERE meeting_id = '$meeting_id'");

    return isset($rows->meeting_id) ? true : false;
  }

  public function activate() {

    flush_rewrite_rules();

    global $wpdb;

    $meeting_rooms_table_name = $wpdb->prefix . 'vidchat_meeting_rooms';
    $vidchat_peers_table_name = $wpdb->prefix . 'vidchat_peers';
    $charset_collate = $wpdb->get_charset_collate();

    $meeting_rooms_sql = "CREATE TABLE IF NOT EXISTS $meeting_rooms_table_name (
        meeting_id VARCHAR(255) NOT NULL,
        date_created datetime DEFAULT CURRENT_TIMESTAMP NOT NULL,
        PRIMARY KEY (meeting_id)
    ) $charset_collate;";

    $peers_sql = "CREATE TABLE IF NOT EXISTS $vidchat_peers_table_name (
      participant_id VARCHAR(255) NOT NULL,
      peer_id VARCHAR(255) NOT NULL,
      meeting_id VARCHAR(255) NOT NULL,
      PRIMARY KEY (participant_id)
    ) $charset_collate;";

    require_once(ABSPATH . 'wp-admin/includes/upgrade.php');

    dbDelta($meeting_rooms_sql);
    dbDelta($peers_sql);
  }
}

if (class_exists('WPVidChat')) {
  $wp_vidchat = new WPVidChat;
}

register_activation_hook(__FILE__, array($wp_vidchat, 'activate'));