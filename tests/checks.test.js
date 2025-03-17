import { Octokit, RequestError } from "octokit";
import { beforeAll, describe, test } from "vitest";
import _ from 'lodash';
import 'lodash.product';
import { createAppAuth } from "@octokit/auth-app";

const octokit = new Octokit({
  authStrategy: createAppAuth,
  auth: {
    appId: 1178750,
    privateKey: process.env.GITHUB_APP_PRIVATE_KEY,
    installationId: 62652949
  }
});

console.log(await octokit.rest.apps.getAuthenticated());

const statuses = [
  'queued',
  'in_progress',
  'completed',
  // Only GitHub Actions can set a status of waiting, pending, or requested.
  // 'waiting',
  // 'requested',
  // 'pending',
];

const conclusions = [
  'action_required',
  'cancelled',
  'failure',
  'neutral',
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

const rulesets = await octokit.paginate(octokit.rest.repos.getRepoRulesets, {
  owner: 'jonathanmorley',
  repo: 'repository-config-testbed',
  includes_parents: false
});

const branches = await octokit.paginate(octokit.rest.repos.listBranches, {
  owner: 'jonathanmorley',
  repo: 'repository-config-testbed'
});

let featureBranchSha;

// Ensure feature branch
beforeAll(async () => {
  const { data: mainTree } = await octokit.rest.git.getTree({
    owner: 'jonathanmorley',
    repo: 'repository-config-testbed',
    tree_sha: main.object.sha
  });

  const { data: tree } = await octokit.rest.git.createTree({
    owner: 'jonathanmorley',
    repo: 'repository-config-testbed',
    base_tree: mainTree.sha,
    tree: [
      {
        path: 'test_file',
        content: Buffer.from('Hello World!').toString('base64'),
        mode: '100644',
      }
    ]
  });

  const { data: commit } = await octokit.rest.git.createCommit({
    owner: 'jonathanmorley',
    repo: 'repository-config-testbed',
    message: 'Create feature branch',
    tree: tree.sha,
    parents: [main.object.sha]
  });

  if (branches.find(branch => branch.name === 'checks/feature')) {
    await octokit.rest.git.updateRef({
      owner: 'jonathanmorley',
      repo: 'repository-config-testbed',
      ref: 'heads/checks/feature',
      sha: commit.sha,
      force: true
    })
  } else {
    await octokit.rest.git.createRef({
      owner: 'jonathanmorley',
      repo: 'repository-config-testbed',
      ref: 'refs/heads/checks/feature',
      sha: commit.sha
    });
  }

  featureBranchSha = commit.sha;
})

describe.concurrent.for(_.product(statuses, conclusions))('Check %s, %s', async ([status, conclusion]) => {
  // Cleanup
  beforeAll(async ({ }) => {
    // Delete branch
    const branch = branches.find(branch => branch.name === `checks/${status}/${conclusion}/main`);
    if (branch) {
      await octokit.rest.git.deleteRef({
        owner: 'jonathanmorley',
        repo: 'repository-config-testbed',
        ref: `heads/${branch.name}`
      });
    }
  }, 90_000);

  // Setup
  beforeAll(async () => {
    // Upsert ruleset
    const ruleset = {
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
    };

    const rulesetId = rulesets.find(r => r.name === ruleset.name)?.id;
    if (rulesetId) await octokit.rest.repos.updateRepoRuleset({ ...ruleset, ruleset_id: rulesetId });
    else await octokit.rest.repos.createRepoRuleset(ruleset);
  
    // Create branch
    await octokit.rest.git.createRef({
      owner: 'jonathanmorley',
      repo: 'repository-config-testbed',
      ref: `refs/heads/checks/${status}/${conclusion}/main`,
      sha: main.object.sha
    });

    // Create check on feature branch
    await octokit.rest.checks.create({
      owner: 'jonathanmorley',
      repo: 'repository-config-testbed',
      head_sha: featureBranchSha,
      name: `${status}/${conclusion}`,
      status,
      conclusion
    });
  }, 40_000);

  test('force update the branch', async ({ expect }) => {
    let result = 'success';
    
    try {
      await octokit.rest.git.updateRef({
        owner: 'jonathanmorley',
        repo: 'repository-config-testbed',
        ref: `heads/checks/${status}/${conclusion}/main`,
        sha: featureBranchSha,
        force: true
      });
    } catch (err) {
      expect(err).toBeInstanceOf(RequestError);
      if (err instanceof RequestError) result = err.message;
    }

    expect(result).toMatchSnapshot();
  });
});
