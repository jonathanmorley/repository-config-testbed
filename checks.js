import { Octokit } from "octokit";

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

const statuses = [
  'queued',
  'in_progress',
  'completed'
];

const conclusions = [
  'action_required',
  'cancelled',
  'failure',
  'neutral',
  'success',
  'skipped',
  'timed_out'
];

const { data: main } = await octokit.rest.git.getRef({
  owner: 'jonathanmorley',
  repo: 'repository-config-testbed',
  ref: 'heads/main'
});

console.log(main);

for (const status of statuses) {
  for (const conclusion of conclusions) {
    const ref = `refs/heads/checks/${status}/${conclusion}`;

    let branchExists;
    try {
      const { data: branch } = await octokit.rest.repos.getBranch({
        owner: 'jonathanmorley',
        repo: 'repository-config-testbed',
        branch: `checks/${status}/${conclusion}`
      });
      branchExists = true;
    } catch (error) {
      if (error instanceof Octokit.HttpError && error.status === 404)
        branchExists = false;
      throw error;
    }
    
    if (!branchExists) {
      await octokit.rest.git.createRef({
        owner: 'jonathanmorley',
        repo: 'repository-config-testbed',
        ref,
        sha: main.object.sha
      });
    }

    await octokit.rest.repos.createRepoRuleset({
      owner: 'jonathanmorley',
      repo: 'repository-config-testbed',
      name: `Checks ${status} ${conclusion}`,
      target: 'branch',
      enforcement: 'active',
      conditions: {
        ref_name: {
          include: [ref],
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
    });
  }
}
