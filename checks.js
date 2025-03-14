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
    await octokit.rest.git.createRef({
      owner: 'jonathanmorley',
      repo: 'repository-config-testbed',
      ref: `refs/heads/checks/${status}/${conclusion}`,
      sha: main.object.sha
    });
  }
}
