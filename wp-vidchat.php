<?php

/**
 * @package Hello_Dolly
 * @version 1.7.2
 */
/*
Plugin Name: WP Vidchat
Plugin URI: https://simonjiloma.com
Description: Video chat with Peer JS webrtc framework
Author: Simon Jiloma
Version: 0.1
Author URI: https://simonjiloma.com
*/


class WPVidChat 
{

  public function __construct() {

    add_action('init', function() {

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

          wp_enqueue_style( 'vidchat_main', plugins_url('wp-vidchat/assets/css/main.css' , __DIR__), [], '0.1');
        }
      });
    });

    add_filter('template_include', function($template) {

      if (is_page('vidchat')) {
        $template = plugin_dir_path( __DIR__ ) . 'wp-vidchat/templates/vidchat.php';
      }

      return $template;
    });

    add_action('rest_api_init', function() {
      
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

    });
    
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

    $meeting_id = $request['meeting_id'];

    $vidchat = get_option('vidchat');
    $vidchat[$meeting_id]['date_created'] = date('Y-m-d H:i:s');
    $vidchat[$meeting_id]['peers'] = [];
    $result = update_option('vidchat', $vidchat);

    if ($result === false) {

      header('Content-Type: application/json');
      echo wp_json_encode([
        'status' => 'error',
        'error_message' => 'Somethin went wrong in saving your meeting id'
      ]);
      exit;

    } else {
      echo wp_json_encode(['status' => 'success']);
      exit;
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

    $vidchat = get_option('vidchat');
    $vidchat[$request['meeting_id']]['peers'][$request['my_participant_id']] = $request['my_peer_id'];

    $result = update_option('vidchat', $vidchat);

    if ($result) {

      $vidchat = get_option('vidchat');
      $peers = $vidchat[$request['meeting_id']]['peers'];
      unset($peers[$request['my_participant_id']]);

      header('Content-Type: application/json');
      echo wp_json_encode([ 
        'status' => 'success',
        'my_peers' => $peers
      ]);
      exit;

    } else {
      header('Content-Type: application/json');
      echo wp_json_encode([
        'status' => 'error',
        'error_message' => 'Cannot save your peer id'
      ]);
      exit;
    }
  }

  public function remove_participant( WP_REST_Request $request ) {

    $vidchat = get_option('vidchat');
    unset($vidchat[$request['meeting_id']]['peers'][$request['my_participant_id']]);

    update_option('vidchat', $vidchat);
  }

}

new WPVidChat;