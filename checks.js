import { Octokit, RequestError } from "octokit";
import { Eta } from "eta"

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
const eta = new Eta({ views: "templates" });

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

for (const status of statuses) {
  for (const conclusion of conclusions) {
    // Ensure ruleset exists
    const rulesetConfig = {
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
            do_not_enforce_on_create: false,
            required_status_checks: [
              {
                context: `${status}/${conclusion}`,
                integration_id: 1178750
              }
            ]
          }
        }
      ],
      bypass_actors: [
        {
          actor_id: 5,
          actor_type: 'RepositoryRole',
        }
      ]
    }

    const rulesets = await octokit.paginate(octokit.rest.repos.getRepoRulesets, {
      owner: 'jonathanmorley',
      repo: 'repository-config-testbed',
      includes_parents: false
    });

    const existingRuleset = rulesets.find(ruleset => ruleset.name === `Checks ${status} ${conclusion}`);
    if (existingRuleset) {
      await octokit.rest.repos.updateRepoRuleset({
        owner: 'jonathanmorley',
        repo: 'repository-config-testbed',
        ruleset_id: existingRuleset.id,
        ...rulesetConfig
      });
    } else {
      await octokit.rest.repos.createRepoRuleset(rulesetConfig);
    }

    // Ensure branches exist
    const branches = [
      `checks/${status}/${conclusion}/main`,
      `checks/${status}/${conclusion}/feature`
    ]

    for (const branch of branches) {
      let branchExists;
      try {
        await octokit.rest.repos.getBranch({
          owner: 'jonathanmorley',
          repo: 'repository-config-testbed',
          branch
        });
        branchExists = true;
      } catch (error) {
        if (error instanceof RequestError && error.status === 404)
          branchExists = false;
        else throw error;
      }

      if (branchExists) {
        await octokit.rest.git.updateRef({
          owner: 'jonathanmorley',
          repo: 'repository-config-testbed',
          ref: `heads/${branch}`,
          sha: main.object.sha,
          force: true
        });
      } else {
        await octokit.rest.git.createRef({
          owner: 'jonathanmorley',
          repo: 'repository-config-testbed',
          ref: `refs/heads/${branch}`,
          sha: main.object.sha
        });
      }
    }

    // push action to feature branch
    const action = eta.render("./check", { status, conclusion });
    await octokit.rest.repos.createOrUpdateFileContents({
      owner: 'jonathanmorley',
      repo: 'repository-config-testbed',
      path: '.github/workflows/check.yml',
      content: Buffer.from(action).toString('base64'),
      message: 'Add check action',
      branch: `checks/${status}/${conclusion}/feature`
    });

    // create pull requests
    await octokit.rest.pulls.create({
      owner: 'jonathanmorley',
      repo: 'repository-config-testbed',
      base: `checks/${status}/${conclusion}/main`,
      head: `checks/${status}/${conclusion}/feature`,
      title: `Test ${status} ${conclusion}`
    });
  }
}
