import { Octokit } from "octokit";
import { Eta } from "eta"
import { beforeAll, describe, test } from "vitest";
import _ from 'lodash';
import 'lodash.product';

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
const eta = new Eta({ views: "templates" });

const statuses = [
  // 'queued',
  // 'in_progress',
  'completed',
  // Only GitHub Actions can set a status of waiting, pending, or requested.
  // 'waiting',
  // 'requested',
  // 'pending',
];

const conclusions = [
  // 'action_required',
  // 'cancelled',
  // 'failure',
  // 'neutral',
  'success',
  'skipped',
  // You cannot change a check run conclusion to stale, only GitHub can set this.
  // 'stale', 
  'timed_out',
];

const { data: main } = await octokit.rest.git.getRef({
  owner: 'jonathanmorley',
  repo: 'repository-config-testbed',
  ref: 'heads/main'
});

const { data: checkFile } = await octokit.rest.repos.getContent({
  owner: 'jonathanmorley',
  repo: 'repository-config-testbed',
  path: '.github/workflows/checks.yml',
  ref: 'main'
});

const rulesets = await octokit.paginate(octokit.rest.repos.getRepoRulesets, {
  owner: 'jonathanmorley',
  repo: 'repository-config-testbed',
  includes_parents: false
});

const branches = await octokit.paginate(octokit.rest.repos.listBranches, {
  owner: 'jonathanmorley',
  repo: 'repository-config-testbed'
});

describe.concurrent.for(_.product(statuses, conclusions))('Check %s, %s', async ([status, conclusion]) => {
  let pullRequest;

  // Cleanup
  beforeAll(async ({ }) => {
    // Delete any existing rulesets
    const ruleset = rulesets.find(ruleset => ruleset.name === `Checks ${status} ${conclusion}`);
    if (ruleset) {
      await octokit.rest.repos.deleteRepoRuleset({
        owner: 'jonathanmorley',
        repo: 'repository-config-testbed',
        ruleset_id: ruleset.id
      });
    }

    // Delete any branches
    for (const branchType of ['main', 'feature']) {
      const branch = branches.find(branch => branch.name === `checks/${status}/${conclusion}/${branchType}`);
      if (branch) {
        await octokit.rest.git.deleteRef({
          owner: 'jonathanmorley',
          repo: 'repository-config-testbed',
          ref: `heads/${branch.name}`
        });
      }
    }

    // Deleting branches will close open PRs
  }, 90_000);

  // Setup
  beforeAll(async () => {
    // Create ruleset
    await octokit.rest.repos.createRepoRuleset({
      owner: 'jonathanmorley',
      repo: 'repository-config-testbed',
      name: `Checks ${status} ${conclusion}`,
      target: 'branch',
      enforcement: 'active',
      conditions: {
        ref_name: {
          include: [`refs/heads/checks/${status}/${conclusion}/main`],
          exclude: []
        }
      },
      rules: [
        {
          type: 'required_status_checks',
          parameters: {
            strict_required_status_checks_policy: false,
            do_not_enforce_on_create: true,
            required_status_checks: [
              {
                context: `${status}/${conclusion}`,
                integration_id: 1178750
              }
            ]
          }
        }
        ]
    });
  
    // Create branches
    for (const branchType of ['main', 'feature']) {
      await octokit.rest.git.createRef({
        owner: 'jonathanmorley',
        repo: 'repository-config-testbed',
        ref: `refs/heads/checks/${status}/${conclusion}/${branchType}`,
        sha: main.object.sha
      });
    }
  
    // push action to feature branch
    const action = eta.render("./check", { status, conclusion });
    await octokit.rest.repos.createOrUpdateFileContents({
      owner: 'jonathanmorley',
      repo: 'repository-config-testbed',
      path: '.github/workflows/check.yml',
      content: Buffer.from(action).toString('base64'),
      message: 'Add check action',
      branch: `checks/${status}/${conclusion}/feature`,
      sha: checkFile.sha
    });
  
    // Create Pull Request
    const {data: pull } = await octokit.rest.pulls.create({
      owner: 'jonathanmorley',
      repo: 'repository-config-testbed',
      base: `checks/${status}/${conclusion}/main`,
      head: `checks/${status}/${conclusion}/feature`,
      title: `Test ${status} ${conclusion}`
    });

    pullRequest = pull;

    await octokit.rest.checks.create({
      owner: 'jonathanmorley',
      repo: 'repository-config-testbed',
      head_sha: pull.head.sha,
      name: `${status}/${conclusion}`,
      status,
      conclusion
    });
  }, 40_000);

  // Wait for check
  test('Check run is created', { retry: 20 }, async ({ expect }) => {
    console.log(`Checking PR ${pullRequest.number} for check ${status}/${conclusion}`);

    const { data: checks } = await octokit.rest.checks.listForRef({
      owner: 'jonathanmorley',
      repo: 'repository-config-testbed',
      ref: pullRequest.head.sha
    });

    expect(checks.total_count).toBeGreaterThan(0);
  });

  test('PR mergeability is correct', { retry: 10 }, async ({ expect }) => {
    const { data: pull } = await octokit.rest.pulls.get({
      owner: 'jonathanmorley',
      repo: 'repository-config-testbed',
      pull_number: pullRequest.number
    });

    expect(pull.mergeable_state).toMatchSnapshot();
  });
});
