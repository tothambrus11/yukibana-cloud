import { test, expect } from 'vitest';
import { launchOf, nextPage, pageOf, rosterRole } from '../src/lib/lti';

const LIS = 'http://purl.imsglobal.org/vocab/lis/v2';

test.each([
  [[`${LIS}/membership#Instructor`], 'assistant'],
  [[`${LIS}/membership#Learner`], 'student'],
  [['Instructor'], 'assistant'],
  [['Learner'], 'student'],
  [[`${LIS}/membership/Instructor#TeachingAssistant`], 'assistant'],
  [[`${LIS}/membership#Learner`, `${LIS}/membership#Instructor`], 'assistant'],
  [[`${LIS}/institution/person#Administrator`], null],
  [['urn:lti:sysrole:ims/lis/Administrator', 'urn:lti:instrole:ims/lis/Administrator'], null],
  [[`${LIS}/system/person#Administrator`, `${LIS}/membership#Learner`], 'student'],
  [[], null],
] as const)('a Moodle member with roles %j is a %s here', (roles, expected) => {
  expect(rosterRole(roles)).toBe(expected);
});

// What Moodle 5.1's member list answered for the local test course, verbatim
// but for its id: a non-editing teacher comes out as Learner.
const moodlePage = {
  id: 'http://localhost:8000/mod/lti/services.php/CourseSection/2/bindings/1/memberships',
  context: { id: '2', label: 'CS-101-2026', title: 'Algorithms and Data Structures 2026' },
  members: [
    { status: 'Active', roles: ['Learner'], user_id: '4', name: 'Tom Assistant', email: 'ta@yukibana.local' },
    { status: 'Active', roles: ['Learner'], user_id: '5', name: 'Alice Student', email: 'Alice@Yukibana.local' },
    { status: 'Active', roles: ['Instructor'], user_id: '3', name: 'Tess Teacher', email: 'teacher@yukibana.local' },
  ],
};

test('a Moodle member list becomes addresses and roles, lowercased', () => {
  expect(pageOf(moodlePage)).toEqual({
    members: [
      { email: 'ta@yukibana.local', role: 'student' },
      { email: 'alice@yukibana.local', role: 'student' },
      { email: 'teacher@yukibana.local', role: 'assistant' },
    ],
    withoutEmail: 0,
    withoutRole: 0,
    inactive: 0,
  });
});

test('a member without an address, without a course role, or not active is left out and counted', () => {
  const page = pageOf({
    members: [
      { roles: ['Learner'], user_id: '1' },
      { roles: ['urn:lti:sysrole:ims/lis/Administrator'], email: 'admin@example.com' },
      { status: 'Inactive', roles: ['Learner'], email: 'gone@example.com' },
    ],
  });
  expect(page).toEqual({ members: [], withoutEmail: 1, withoutRole: 1, inactive: 1 });
});

test('something that is not a member list says so instead of meaning nobody', () => {
  expect(pageOf({ error: 'nope' })).toBe('The member list has no members array.');
  expect(pageOf(null)).toBe('The member list has no members array.');
});

test('the next page comes from the Link header, and the last page has none', () => {
  expect(nextPage('<http://m/memberships?limit=2&from=2>; rel="next"')).toBe('http://m/memberships?limit=2&from=2');
  expect(nextPage('<http://m/a>; rel="prev", <http://m/b>; rel=next')).toBe('http://m/b');
  expect(nextPage(null)).toBe(null);
  expect(nextPage('<http://m/a>; rel="prev"')).toBe(null);
});

const launch = {
  iss: 'http://localhost:8000',
  sub: '3',
  email: 'Teacher@Yukibana.local',
  name: 'Tess Teacher',
  'https://purl.imsglobal.org/spec/lti/claim/message_type': 'LtiResourceLinkRequest',
  'https://purl.imsglobal.org/spec/lti/claim/version': '1.3.0',
  'https://purl.imsglobal.org/spec/lti/claim/deployment_id': '1',
  'https://purl.imsglobal.org/spec/lti/claim/roles': [`${LIS}/membership#Instructor`, `${LIS}/institution/person#Administrator`],
  'https://purl.imsglobal.org/spec/lti/claim/context': { id: '2', label: 'CS-101-2026', title: 'Algorithms and Data Structures 2026' },
  'https://purl.imsglobal.org/spec/lti-nrps/claim/namesroleservice': {
    context_memberships_url: 'http://localhost:8000/mod/lti/services.php/CourseSection/2/bindings/1/memberships',
    service_versions: ['1.0', '2.0'],
  },
};

test("a teacher's launch from a Moodle course names the course, its member list and the teacher", () => {
  expect(launchOf(launch)).toEqual({
    deploymentId: '1',
    subject: '3',
    email: 'teacher@yukibana.local',
    name: 'Tess Teacher',
    role: 'assistant',
    context: { id: '2', title: 'Algorithms and Data Structures 2026' },
    membershipsUrl: 'http://localhost:8000/mod/lti/services.php/CourseSection/2/bindings/1/memberships',
  });
});

test('a launch that is not from a course, or not a resource link, is refused with a reason', () => {
  const { ['https://purl.imsglobal.org/spec/lti/claim/context']: _, ...noContext } = launch;
  expect(launchOf(noContext)).toBe('The launch was not made from a course.');
  expect(launchOf({ ...launch, 'https://purl.imsglobal.org/spec/lti/claim/message_type': 'LtiDeepLinkingRequest' })).toBe('This is not a resource link launch.');
});

test('a launch without the member list service still launches, and says it has none', () => {
  const { ['https://purl.imsglobal.org/spec/lti-nrps/claim/namesroleservice']: _, ...noNrps } = launch;
  const result = launchOf(noNrps);
  expect(typeof result === 'string' ? result : result.membershipsUrl).toBe(null);
});
