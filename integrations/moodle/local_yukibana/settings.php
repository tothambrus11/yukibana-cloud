<?php
defined('MOODLE_INTERNAL') || die();

if ($hassiteconfig) {
    $settings = new admin_settingpage('local_yukibana', get_string('pluginname', 'local_yukibana'));
    $settings->add(new admin_setting_configtext('local_yukibana/hinturl',
        get_string('hinturl', 'local_yukibana'), get_string('hinturl_desc', 'local_yukibana'), '', PARAM_URL));
    $settings->add(new admin_setting_configtext('local_yukibana/clientid',
        get_string('clientid', 'local_yukibana'), get_string('clientid_desc', 'local_yukibana'), '', PARAM_ALPHANUMEXT));
    $ADMIN->add('localplugins', $settings);
}
