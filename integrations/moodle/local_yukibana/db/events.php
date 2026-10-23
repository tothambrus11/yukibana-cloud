<?php
// Every event that changes who is in a course, or as what. What none of
// these catch is an enrolment that simply runs out (its end date passes):
// Moodle fires nothing for that, which is why Yukibana also syncs on a
// schedule.
defined('MOODLE_INTERNAL') || die();

$observers = [];
foreach ([
    '\core\event\user_enrolment_created',
    '\core\event\user_enrolment_updated', // Suspended, reactivated, dates changed.
    '\core\event\user_enrolment_deleted',
    '\core\event\role_assigned',
    '\core\event\role_unassigned',
] as $event) {
    $observers[] = ['eventname' => $event, 'callback' => '\local_yukibana\observer::roster_changed'];
}
