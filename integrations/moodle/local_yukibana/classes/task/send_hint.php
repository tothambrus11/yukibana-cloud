<?php
namespace local_yukibana\task;

defined('MOODLE_INTERNAL') || die();

/**
 * Tells Yukibana that one course's members changed. The hint carries the
 * course id and nothing else: Yukibana answers it by fetching the member
 * list itself, over the LTI service it is already allowed to use, so the
 * hint needs no secret and leaks nothing if it goes astray.
 */
class send_hint extends \core\task\adhoc_task {
    public function get_name(): string {
        return get_string('task_send_hint', 'local_yukibana');
    }

    public function execute(): void {
        global $CFG;
        require_once($CFG->libdir . '/filelib.php'); // For \curl, which is not autoloaded.
        $url = get_config('local_yukibana', 'hinturl');
        $clientid = get_config('local_yukibana', 'clientid');
        if (empty($url) || empty($clientid)) {
            return;
        }
        $body = json_encode([
            'issuer' => $CFG->wwwroot,
            'client_id' => $clientid,
            'context_id' => (string) $this->get_custom_data()->courseid,
        ]);
        $curl = new \curl();
        $curl->setHeader(['Content-Type: application/json']);
        $curl->post($url, $body, ['CURLOPT_TIMEOUT' => 10]);
        $status = $curl->get_info()['http_code'] ?? 0;
        if ($status < 200 || $status >= 300) {
            // Thrown, so the task is retried later with back-off.
            throw new \moodle_exception('error', 'error', '', null, "Yukibana answered $status to a roster hint");
        }
        mtrace("Yukibana roster hint for course {$this->get_custom_data()->courseid}: HTTP $status");
    }
}
