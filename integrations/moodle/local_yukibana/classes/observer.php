<?php
namespace local_yukibana;

defined('MOODLE_INTERNAL') || die();

/**
 * Turns a roster event into a queued hint for its course.
 *
 * The HTTP request is not made here: an observer runs inside the request
 * that enrolled someone, and a slow or unreachable Yukibana must not make
 * enrolling slow. An ad hoc task sends it at the next cron run, and a burst
 * of events for one course (a teacher enrolling a list) queues one task,
 * because a task with the same data is not queued twice.
 */
class observer {
    public static function roster_changed(\core\event\base $event): void {
        if (empty(get_config('local_yukibana', 'hinturl')) || empty($event->courseid) || $event->courseid == SITEID) {
            return;
        }
        $task = new task\send_hint();
        $task->set_custom_data(['courseid' => (int) $event->courseid]);
        \core\task\manager::queue_adhoc_task($task, true);
    }
}
