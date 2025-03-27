import { Octokit, } from "octokit";
import { beforeAll, describe, it } from "vitest";
import _ from 'lodash';
import 'lodash.product';
import { createAppAuth } from "@octokit/auth-app";
import { setTimeout } from 'node:timers/promises';
import unzipper, { File } from 'unzipper';

const apptokit = new Octokit({
  authStrategy: createAppAuth,
  auth: {
    appId: 1178750,
    privateKey: process.env.GITHUB_APP_PRIVATE_KEY,
    installationId: 62652949
  }
});

const tokentokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

const workflowOns = [
  null, // No workflow at all
  'workflow_dispatch', // Not triggered by PRs
  'pull_request',
  'pull_request_target'
];

const { data: main } = await tokentokit.rest.git.getRef({
  owner: 'jonathanmorley',
  repo: 'repository-config-testbed',
  ref: 'heads/main'
});

const branches = await tokentokit.paginate(tokentokit.rest.repos.listBranches, {
  owner: 'jonathanmorley',
  repo: 'repository-config-testbed'
});

describe.concurrent.for(_.product(workflowOns, workflowOns))('PR Workflow (from: %s, to: %s)', async ([fromOn, toOn]) => {
  const branchPrefix = `workflows/from@${fromOn}/to@${toOn}`;
  let pullRequest: Awaited<ReturnType<Octokit['rest']['pulls']['get']>>['data'];
  let logs: File[] | undefined;

  // Cleanup
  beforeAll(async () => {
    // Delete branches
    for (const branchType of ['main', 'feature']) {
      const branch = branches.find(branch => branch.name === `${branchPrefix}/${branchType}`);
      if (branch) {
        await apptokit.rest.git.deleteRef({
          owner: 'jonathanmorley',
          repo: 'repository-config-testbed',
          ref: `heads/${branch.name}`
        });
      }
    }

    // Wait 5s for branches to be deleted
    await setTimeout(5_000);

    // Branch deletion will close any PRs
  }, 20_000);

  // Setup
  beforeAll(async () => {
    // Create main branch
    await tokentokit.rest.git.createRef({
      owner: 'jonathanmorley',
      repo: 'repository-config-testbed',
      ref: `refs/heads/${branchPrefix}/main`,
      sha: main.object.sha
    });

    // Push workflow to main branch
    let mainSha = main.object.sha;
    let updateTestMain: Awaited<ReturnType<typeof tokentokit.rest.repos.createOrUpdateFileContents>>['data'] | undefined = undefined;
    if (fromOn) {
      const { data: update } = await tokentokit.rest.repos.createOrUpdateFileContents({
        owner: 'jonathanmorley',
        repo: 'repository-config-testbed',
        path: `.github/workflows/workflow.yml`,
        message: 'Add workflow to main branch',
        content: Buffer.from(JSON.stringify({
          on: [toOn],
          jobs: {
            placeholder: {
              'runs-on': 'ubuntu-latest',
              steps: [
                { uses: 'actions/checkout@v4' },
                { run: 'echo "Hello World!"' },
                { run: 'git symbolic-ref --short HEAD', 'continue-on-error': true },
                { run: 'git rev-parse --abbrev-ref HEAD', 'continue-on-error': true },
                { run: 'git branch --show-current', 'continue-on-error': true },
                { run: "git for-each-ref --points-at HEAD 'refs/**/*' | cut -f2", 'continue-on-error': true }
              ]
            }
          }
        })).toString('base64'),
        branch: `${branchPrefix}/main`
      });

      mainSha = update?.commit?.sha!;
      updateTestMain = update;
    }

    // Create feature branch from main
    await tokentokit.rest.git.createRef({
      owner: 'jonathanmorley',
      repo: 'repository-config-testbed',
      ref: `refs/heads/${branchPrefix}/feature`,
      sha: mainSha
    });

    // Push workflow to feature branch
    if (toOn) {
      await tokentokit.rest.repos.createOrUpdateFileContents({
        owner: 'jonathanmorley',
        repo: 'repository-config-testbed',
        path: `.github/workflows/workflow.yml`,
        message: 'Add workflow to feature branch',
        sha: updateTestMain?.content?.sha!,
        content: Buffer.from(JSON.stringify({
          on: [toOn],
          jobs: {
            placeholder: {
              'runs-on': 'ubuntu-latest',
              steps: [
                { uses: 'actions/checkout@v4' },
                { run: 'echo "Malicious Input"' },
                { run: 'git symbolic-ref --short HEAD', 'continue-on-error': true },
                { run: 'git rev-parse --abbrev-ref HEAD', 'continue-on-error': true },
                { run: 'git branch --show-current', 'continue-on-error': true },
                { run: "git for-each-ref --points-at HEAD 'refs/**/*' | cut -f2", 'continue-on-error': true }
              ]
            }
          }
        })).toString('base64'),
        branch: `${branchPrefix}/feature`
      });
    } else {
      if (fromOn) {
        await tokentokit.rest.repos.deleteFile({
          owner: 'jonathanmorley',
          repo: 'repository-config-testbed',
          path: `.github/workflows/workflow.yml`,
          message: 'Delete workflow from feature branch',
          sha: updateTestMain?.content?.sha!,
          branch: `${branchPrefix}/feature`
        });
      } else {
        // Create dummy file
        await tokentokit.rest.repos.createOrUpdateFileContents({
          owner: 'jonathanmorley',
          repo: 'repository-config-testbed',
          path: `test_file`,
          message: 'Add dummy file to feature branch',
          content: Buffer.from('Dummy file').toString('base64'),
          branch: `${branchPrefix}/feature`
        });
      }
    }

    // Open Pull Request
    const { data: pull } = await tokentokit.rest.pulls.create({
      owner: 'jonathanmorley',
      repo: 'repository-config-testbed',
      title: `Workflows (from: ${fromOn}, to: ${toOn})`,
      head: `${branchPrefix}/feature`,
      base: `${branchPrefix}/main`
    });

    pullRequest = pull;
  }, 40_000);

  it('should run the workflow', { retry: 20 }, async ({ expect, onTestFailed }) => {
    onTestFailed(async () => await setTimeout(5_000), 10_000);

    // Find workflow run
    const { data: workflowRuns } = await tokentokit.rest.actions.listWorkflowRuns({
      owner: 'jonathanmorley',
      repo: 'repository-config-testbed',
      workflow_id: 'workflow.yml',
      head_sha: pullRequest.head.sha,
    });

    // Check if workflow run exists
    const workflowRun = workflowRuns.workflow_runs.find(run => run.head_sha === pullRequest.head.sha);

    if (toOn === 'pull_request_target' && [null, 'workflow_dispatch'].includes(fromOn)) {
      // pull_request_target is triggered based on the base branch's workflow
      expect(workflowRun).toBeUndefined();
    } else if ([null, 'workflow_dispatch'].includes(toOn)) {
      // If the triggers don't exist in the PR, the workflow should not run
      expect(workflowRun).toBeUndefined();
    } else if (fromOn === 'pull_request' && toOn === 'pull_request_target') {
      // Unsure why this is not running
      expect(workflowRun).toBeUndefined();
    } else {
      expect(workflowRun).toBeDefined();

      // Check if workflow run has succeeded
      expect(workflowRun!.status).toBe('completed');
      expect(workflowRun!.conclusion).toBe('success');

      const { data: logsZip } = await tokentokit.rest.actions.downloadWorkflowRunLogs({
        owner: 'jonathanmorley',
        repo: 'repository-config-testbed',
        run_id: workflowRun!.id
      });

      const allLogs = await unzipper.Open.buffer(Buffer.from(logsZip as ArrayBuffer));
      logs = allLogs.files;
    }
  });

  it('has the expected logs', async ({ expect }) => {
    if (logs) {
      expect(logs?.map(file => file.path)).toMatchSnapshot();
    }
  });

  it('the workflow should run from the expected ref', async ({ expect }) => {
    if (logs) {
      const stepLog = logs[4];
      const logBuffer = await stepLog.buffer();
      const logLines = logBuffer.toString('utf-8').split('\n').map(line => line.slice(29));
      const output = logLines.slice(logLines.indexOf("##[endgroup]")+1).filter(Boolean).join('\n');
      expect(output).toMatchSnapshot();
    }
  });

  it('should have the expected symbolic ref', async ({ expect }) => {
    if (logs) {
      const stepLog = logs[5];
      const logBuffer = await stepLog.buffer();
      const logLines = logBuffer.toString('utf-8').split('\n').map(line => line.slice(29));
      const output = logLines.slice(logLines.indexOf("##[endgroup]")+1).filter(Boolean).join('\n');
      expect(output).toMatchSnapshot();
    }
  });

  it('should have the expected ref-parse', async ({ expect }) => {
    if (logs) {
      const stepLog = logs[6];
      const logBuffer = await stepLog.buffer();
      const logLines = logBuffer.toString('utf-8').split('\n').map(line => line.slice(29));
      const output = logLines.slice(logLines.indexOf("##[endgroup]")+1).filter(Boolean).join('\n');
      expect(output).toMatchSnapshot();
    }
  });

  it('should have the expected branch', async ({ expect }) => {
    if (logs) {
      const stepLog = logs[7];
      const logBuffer = await stepLog.buffer();
      const logLines = logBuffer.toString('utf-8').split('\n').map(line => line.slice(29));
      const output = logLines.slice(logLines.indexOf("##[endgroup]")+1).filter(Boolean).join('\n');
      expect(output).toMatchSnapshot();
    }
  });

  it('should have the expected for-each-ref', async ({ expect }) => {
    if (logs) {
      const stepLog = logs[8];
      const logBuffer = await stepLog.buffer();
      const logLines = logBuffer.toString('utf-8').split('\n').map(line => line.slice(29));
      const output = logLines.slice(logLines.indexOf("##[endgroup]")+1).filter(Boolean).join('\n')
      const normalizedOutput = output.replace(/refs\/remotes\/pull\/\d+\/merge/, 'refs/remotes/pull/1/merge');
      expect(normalizedOutput).toMatchSnapshot();
    }
  });
});
