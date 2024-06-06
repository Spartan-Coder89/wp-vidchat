<?php

if (!defined('WP_UNINSTALL_PLUGIN')) {
  die;
}

global $wpdb;

$tables = [
  $wpdb->prefix . 'vidchat_meeting_rooms',
  $wpdb->prefix . 'vidchat_peers'
];

foreach ($tables as $table) {
  $sql = "DROP TABLE IF EXISTS $table";
  $wpdb->query($sql);
}