<?php
// A local Moodle course wired to a local Yukibana registry, for trying the
// roster sync (PROTOTYPE, docs/moodle-sync.md). Run inside the Moodle web
// container, from Moodle's root:
//
//   php /path/to/seed.php [tool url as the browser sees it] [keyset url as Moodle sees it]
//
// Idempotent: users, the course and the tool are found again by name.
// Prints the values `app.register_lti_platform` needs, as JSON.
//
// Never run this against a real Moodle: it relaxes Moodle's outbound HTTP
// blocklist so that Moodle may fetch the tool's keys from a private address.

define('CLI_SCRIPT', true);
require(getcwd() . '/config.php');
require_once($CFG->dirroot . '/mod/lti/locallib.php');
require_once($CFG->dirroot . '/user/lib.php');
require_once($CFG->dirroot . '/course/lib.php');
require_once($CFG->dirroot . '/enrol/locallib.php');

$toolurl = $argv[1] ?? 'http://127.0.0.1:5173';
$keyseturl = $argv[2] ?? 'http://host.docker.internal:5173/lti/jwks';

\core\session\manager::set_user(get_admin());

// Development only: Moodle refuses to reach private addresses and odd
// ports by default, which is right in production and in the way here.
set_config('curlsecurityblockedhosts', '');
set_config('curlsecurityallowedport', '');

function seed_user(string $username, string $first, string $last): stdClass {
    global $DB, $CFG;
    if ($u = $DB->get_record('user', ['username' => $username])) {
        return $u;
    }
    $id = user_create_user((object) [
        'username' => $username, 'password' => 'Test-1234', 'firstname' => $first, 'lastname' => $last,
        'email' => "$username@yukibana.local", 'auth' => 'manual', 'confirmed' => 1, 'mnethostid' => $CFG->mnet_localhost_id,
    ]);
    return $DB->get_record('user', ['id' => $id]);
}

$people = [
    'teacher' => seed_user('teacher', 'Tess', 'Teacher'),
    'ta' => seed_user('ta', 'Tom', 'Assistant'),
    'alice' => seed_user('alice', 'Alice', 'Student'),
    'bob' => seed_user('bob', 'Bob', 'Student'),
    'carol' => seed_user('carol', 'Carol', 'Student'),
];

$course = $DB->get_record('course', ['shortname' => 'CS-101-2026']);
if (!$course) {
    $course = create_course((object) [
        'fullname' => 'Algorithms and Data Structures 2026', 'shortname' => 'CS-101-2026', 'category' => 1,
    ]);
}

$roles = [
    'teacher' => $DB->get_field('role', 'id', ['shortname' => 'editingteacher']),
    'ta' => $DB->get_field('role', 'id', ['shortname' => 'teacher']),
    'alice' => $DB->get_field('role', 'id', ['shortname' => 'student']),
    'bob' => $DB->get_field('role', 'id', ['shortname' => 'student']),
];
$manual = enrol_get_plugin('manual');
$instance = $DB->get_record('enrol', ['courseid' => $course->id, 'enrol' => 'manual'], '*', MUST_EXIST);
foreach ($roles as $who => $roleid) {
    $manual->enrol_user($instance, $people[$who]->id, $roleid);
}
// Carol is created but not enrolled: enrolling her is the first change to try.

$type = $DB->get_record('lti_types', ['name' => 'Yukibana (local)']);
if (!$type) {
    $typeid = lti_add_type((object) [
        'state' => LTI_TOOL_STATE_CONFIGURED,
    ], (object) [
        'lti_typename' => 'Yukibana (local)',
        'lti_toolurl' => "$toolurl/lti/launch",
        'lti_ltiversion' => LTI_VERSION_1P3,
        'lti_keytype' => LTI_JWK_KEYSET,
        'lti_publickeyset' => $keyseturl,
        'lti_initiatelogin' => "$toolurl/lti/login",
        'lti_redirectionuris' => "$toolurl/lti/launch",
        'lti_coursevisible' => LTI_COURSEVISIBLE_ACTIVITYCHOOSER,
        // A new window, not an iframe: the tool's launch cookies would be
        // third-party cookies in a frame, and browsers drop those.
        'lti_launchcontainer' => LTI_LAUNCH_CONTAINER_WINDOW,
        'lti_sendname' => LTI_SETTING_ALWAYS,
        'lti_sendemailaddr' => LTI_SETTING_ALWAYS,
        'lti_acceptgrades' => LTI_SETTING_NEVER,
        'lti_contentitem' => 0,
        // The member list (NRPS): "use this service to retrieve members'
        // information as per privacy settings".
        'ltiservice_memberships' => 1,
    ]);
    $type = $DB->get_record('lti_types', ['id' => $typeid]);
}

if (!$DB->record_exists('lti', ['course' => $course->id, 'typeid' => $type->id])) {
    $module = $DB->get_record('modules', ['name' => 'lti'], '*', MUST_EXIST);
    create_module((object) [
        'modulename' => 'lti', 'module' => $module->id, 'course' => $course->id, 'section' => 0, 'visible' => 1,
        'name' => 'Yukibana', 'typeid' => $type->id, 'toolurl' => '', 'instructorchoicesendname' => 1,
        'instructorchoicesendemailaddr' => 1, 'launchcontainer' => LTI_LAUNCH_CONTAINER_WINDOW,
        'introeditor' => ['text' => '', 'format' => FORMAT_HTML, 'itemid' => 0],
    ]);
}

echo json_encode([
    'issuer' => $CFG->wwwroot,
    'client_id' => $type->clientid,
    'deployment_id' => (string) $type->id,
    'auth_url' => "$CFG->wwwroot/mod/lti/auth.php",
    'token_url' => "$CFG->wwwroot/mod/lti/token.php",
    'jwks_url' => "$CFG->wwwroot/mod/lti/certs.php",
    'course_id' => (string) $course->id,
    'users' => array_map(fn($u) => $u->id, $people),
], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . "\n";
