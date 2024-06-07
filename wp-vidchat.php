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
    <table style="max-width: 480px; width: 100%; border: 1px solid #E3EEFF; border-radius: 10px; padding: 20px 30px;" width="100%">
      <tbody>
        <tr>
          <td style="font-family: "Arial"; padding: 10px 0px;">
            <img src="'. plugins_url('wp-vidchat/assets/images/invitation-logo.png') .'">
          </td>
        </tr>
        <tr>
          <td style="font-family: "Arial"; padding: 10px 0px;">
            <p id="greetings" style="font-family: "Arial"; line-height: 140%;">Hello sjiloma1389@gmail.com,</p>
          </td>
        </tr>
        <tr>
          <td style="font-family: "Arial"; padding: 10px 0px;">
            <p id="body" style="font-family: "Arial"; line-height: 140%;">Simon Jiloma is inviting you for a video chat right now. Just click the button below to join the session right from your browser.</p>
          </td>
        </tr>
        <tr>
          <td style="font-family: "Arial"; padding: 10px 0px;">
            <a id="link_button" href="'. get_site_url() .'?meeting-id='. $meeting_id .'" style="text-decoration: none; color: #004cc6; display: block; max-width: 215px; text-align: center; background-color: #004CC6; padding: 15px; border-radius: 5px;">
              <img src="'. plugins_url('wp-vidchat/assets/images/invitation-link-icon.png') .'" style="display: inline-block; vertical-align: middle; margin-right: 10px;">
              <span style="display: inline-block; vertical-align: middle; color: #fff; font-weight: 600;">Join now</span>
            </a>
          </td>
        </tr>
        <tr>
          <td style="font-family: "Arial"; padding: 10px 0px;">
            <p id="note" style="font-family: "Arial"; line-height: 140%;">
              If the button above does not work try opening this link 
              <a href="'. get_site_url() .'?meeting-id='. $meeting_id .'" style="text-decoration: none; color: #004cc6;">'. get_site_url() .'?meeting-id='. $meeting_id .'</a> 
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