Feature: Launchpad cohorts, invites, portals and mentor assignment
  Officers run Buildspace + Launchpad one cohort at a time. They invite builders by email,
  builders onboard into their own portal, mentors get a portal for the projects assigned to
  them, and officers can archive, restore or delete records without losing history.
  (docs/launchpad-cohorts.md)

  Background:
    Given the dashboard is seeded and developer sign-in is on

  Scenario: A director creates a cohort and works inside it
    Given I am signed in as a director on Buildspace + Launchpad
    When I create a new cohort for this run
    Then the cohort switcher selects the new cohort
    And the URL remembers the cohort
    And the register is empty for the new cohort

  Scenario: An officer can read cohorts but not manage them
    Given I am signed in as an officer on Buildspace + Launchpad
    Then I can see the cohort switcher
    But I cannot create, edit or archive cohorts

  Scenario: A director invites builders by pasting a list
    Given I am a director on the new cohort's Invites tab
    When I paste two new emails, a duplicate and an invalid line
    Then the preview shows 2 valid, 1 duplicate and 1 invalid row
    When I send the invites as links
    Then I get one join link per new builder
    And both invites are listed as invited

  Scenario: The first builder accepts the invite and starts a project
    Given the first builder opens their join link
    Then the join page shows the cohort, the builder role and a masked email
    When they continue with Discord account A
    Then they see the setup wizard
    When they enter their name, pronouns, role on the team and bio
    And they start a new Software project
    And they confirm their setup
    Then their dashboard shows their name, role on the team and project
    And their dashboard fits a phone screen

  Scenario: The second builder joins the existing project
    Given the second builder accepts their invite with Discord account B
    When they complete setup by joining the first builder's project
    Then the team card lists both builders

  Scenario: An invite link works only once
    When someone opens the first builder's link again with Discord account C
    Then they are told the invite was already used

  Scenario: Officers see accepted invites and linked builders
    Given I am a director on the new cohort's Invites tab
    Then both invites show as active
    And the People register lists both builders with active portal accounts

  Scenario: A builder posts a weekly check-in
    Given the first builder is on their dashboard
    When they post a weekly check-in
    Then this week shows as done
    And officers see the check-in on the builder's timeline

  Scenario: A director invites a mentor to the mentor portal
    Given a new mentor contact exists with no portal account
    When I invite the mentor from the Mentors tab with link delivery
    Then I get a single-use mentor join link
    When the mentor accepts it with Discord account D
    Then the mentor dashboard shows no projects yet

  Scenario: Auto-assign gives the unmentored project to the least-loaded mentor
    Given I am a director on the new cohort's Mentors tab
    When I open Auto-assign mentors
    Then the preview proposes the cohort's project for the new mentor
    When I apply the assignments
    Then the project lists the new mentor
    And the mentor dashboard shows the project

  Scenario: Mentor notes respect who can see them
    Given the mentor opens the assigned project
    When they add a note shared with the builders
    And they add a note for mentors and officers only
    Then the builder's timeline shows the shared note
    But the builder's timeline does not show the mentors-only note
    And the mentor dashboard fits a phone screen

  Scenario: Archiving a builder pauses their portal access until restored
    Given I am a director viewing the second builder
    When I archive the second builder
    Then their portal says access is paused
    And the portal API refuses them as archived
    When I restore the second builder
    Then they can use their dashboard again

  Scenario: Delete is only for records without history
    Given I am a director viewing the first builder
    When I try to delete the first builder
    Then I am told to archive instead because they have history
    When I add an empty project to the cohort and delete it
    Then the project is gone from the register

  Scenario: Portal sessions are walled off from the officer dashboard
    Given the first builder is signed in to the portal
    Then officer APIs answer 401 to their portal session
    And the mentor portal API answers 403 to a builder
    When a signed-out visitor opens the portal
    Then they are sent to the portal sign-in page

  Scenario: Archiving a cohort makes it read-only
    Given I am a director viewing the new cohort
    When I archive the cohort
    Then the register shows a read-only banner
    And the first builder's dashboard is read-only
