import {
  ChangeSetStatus,
  ChangeSetType,
  CreateChangeSetCommand,
  type CreateChangeSetCommandInput,
  CreateStackCommand,
  DeleteChangeSetCommand,
  DeleteStackCommand,
  DescribeChangeSetCommand,
  DescribeStacksCommand,
  ExecuteChangeSetCommand,
  type ExecuteChangeSetCommandInput,
  GetTemplateCommand,
  type Stack,
  StackStatus,
  UpdateStackCommand,
  UpdateTerminationProtectionCommand,
} from '@aws-sdk/client-cloudformation';
import { assertIsSuccessfulDeployStackResult } from '../../../lib/api/deployments';
import type { DeployStackOptions as DeployStackApiOptions } from '../../../lib/api/deployments/deploy-stack';
import { deployStack } from '../../../lib/api/deployments/deploy-stack';
import { NoBootstrapStackEnvironmentResources } from '../../../lib/api/environment';
import { HotswapMode } from '../../../lib/api/hotswap/common';
import { tryHotswapDeployment } from '../../../lib/api/hotswap/hotswap-deployments';
import { DEFAULT_FAKE_TEMPLATE, testStack } from '../../_helpers/assembly';
import {
  mockCloudFormationClient,
  mockResolvedEnvironment,
  MockSdk,
  MockSdkProvider,
  restoreSdkMocksToDefault,
} from '../../_helpers/mock-sdk';
import { TestIoHost } from '../../_helpers/test-io-host';

let ioHost = new TestIoHost();
let ioHelper = ioHost.asHelper('deploy');

function testDeployStack(options: DeployStackApiOptions) {
  return deployStack(options, ioHelper);
}

jest.mock('../../../lib/api/hotswap/hotswap-deployments');
jest.mock('../../../lib/api/deployments/checks', () => ({
  determineAllowCrossAccountAssetPublishing: jest.fn().mockResolvedValue(true),
}));

const FAKE_STACK = testStack({
  stackName: 'withouterrors',
});

const FAKE_STACK_WITH_PARAMETERS = testStack({
  stackName: 'withparameters',
  template: {
    Parameters: {
      HasValue: { Type: 'String' },
      HasDefault: { Type: 'String', Default: 'TheDefault' },
      OtherParameter: { Type: 'String' },
    },
  },
});

const FAKE_STACK_TERMINATION_PROTECTION = testStack({
  stackName: 'termination-protection',
  template: DEFAULT_FAKE_TEMPLATE,
  terminationProtection: true,
});

const baseResponse = {
  StackName: 'mock-stack-name',
  StackId: 'mock-stack-id',
  CreationTime: new Date(),
  StackStatus: StackStatus.CREATE_COMPLETE,
  EnableTerminationProtection: false,
};

let sdk: MockSdk;
let sdkProvider: MockSdkProvider;

beforeEach(() => {
  sdkProvider = new MockSdkProvider();
  sdk = new MockSdk();
  sdk.getUrlSuffix = () => Promise.resolve('amazonaws.com');
  jest.resetAllMocks();

  restoreSdkMocksToDefault();
  mockCloudFormationClient
    .on(DescribeStacksCommand)
    // First call, no stacks exis
    .resolvesOnce({
      Stacks: [],
    })
    // Second call, stack has been created
    .resolves({
      Stacks: [
        {
          StackStatus: StackStatus.CREATE_COMPLETE,
          StackStatusReason: 'It is magic',
          EnableTerminationProtection: false,
          StackName: 'MagicalStack',
          CreationTime: new Date(),
        },
      ],
    });
  mockCloudFormationClient.on(DescribeChangeSetCommand).resolves({
    Status: StackStatus.CREATE_COMPLETE,
    Changes: [],
  });
  mockCloudFormationClient.on(GetTemplateCommand).resolves({
    TemplateBody: JSON.stringify(DEFAULT_FAKE_TEMPLATE),
  });
  mockCloudFormationClient.on(UpdateTerminationProtectionCommand).resolves({
    StackId: 'stack-id',
  });
});

function standardDeployStackArguments(): DeployStackApiOptions {
  const resolvedEnvironment = mockResolvedEnvironment();
  return {
    stack: FAKE_STACK,
    sdk,
    sdkProvider,
    resolvedEnvironment,
    envResources: new NoBootstrapStackEnvironmentResources(resolvedEnvironment, sdk, ioHelper),
  };
}

test("calls tryHotswapDeployment() if 'hotswap' is `HotswapMode.CLASSIC`", async () => {
  // WHEN
  const spyOnSdk = jest.spyOn(sdk, 'appendCustomUserAgent');
  await testDeployStack({
    ...standardDeployStackArguments(),
    hotswap: HotswapMode.FALL_BACK,
    extraUserAgent: 'extra-user-agent',
  });

  // THEN
  expect(tryHotswapDeployment).toHaveBeenCalled();
  // check that the extra User-Agent is honored
  expect(spyOnSdk).toHaveBeenCalledWith('extra-user-agent');
  // check that the fallback has been called if hotswapping failed
  expect(spyOnSdk).toHaveBeenCalledWith('cdk-hotswap/fallback');
});

test("calls tryHotswapDeployment() if 'hotswap' is `HotswapMode.HOTSWAP_ONLY`", async () => {
  // we need the first call to return something in the Stacks prop,
  // otherwise the access to `stackId` will fail
  mockCloudFormationClient.on(DescribeStacksCommand).resolves({
    Stacks: [{ ...baseResponse }],
  });
  const spyOnSdk = jest.spyOn(sdk, 'appendCustomUserAgent');
  // WHEN
  const deployStackResult = await testDeployStack({
    ...standardDeployStackArguments(),
    hotswap: HotswapMode.HOTSWAP_ONLY,
    extraUserAgent: 'extra-user-agent',
    forceDeployment: true, // otherwise, deployment would be skipped
  });

  // THEN
  expect(deployStackResult.type === 'did-deploy-stack' && deployStackResult.noOp).toEqual(true);
  expect(tryHotswapDeployment).toHaveBeenCalled();
  // check that the extra User-Agent is honored
  expect(spyOnSdk).toHaveBeenCalledWith('extra-user-agent');
  // check that the fallback has not been called if hotswapping failed
  expect(spyOnSdk).not.toHaveBeenCalledWith('cdk-hotswap/fallback');
});

test('correctly passes CFN parameters when hotswapping', async () => {
  // WHEN
  await testDeployStack({
    ...standardDeployStackArguments(),
    hotswap: HotswapMode.FALL_BACK,
    parameters: {
      A: 'A-value',
      B: 'B=value',
      C: undefined,
      D: '',
    },
  });

  // THEN
  expect(tryHotswapDeployment).toHaveBeenCalledWith(
    expect.anything(),
    expect.anything(),
    { A: 'A-value', B: 'B=value' },
    expect.anything(),
    expect.anything(),
    HotswapMode.FALL_BACK,
    expect.anything(),
  );
});

test('correctly passes SSM parameters when hotswapping', async () => {
  // GIVEN
  mockCloudFormationClient.on(DescribeStacksCommand).resolves({
    Stacks: [
      {
        ...baseResponse,
        Parameters: [{ ParameterKey: 'SomeParameter', ParameterValue: 'ParameterName', ResolvedValue: 'SomeValue' }],
      },
    ],
  });

  // WHEN
  await testDeployStack({
    ...standardDeployStackArguments(),
    stack: testStack({
      stackName: 'stack',
      template: {
        Parameters: {
          SomeParameter: {
            Type: 'AWS::SSM::Parameter::Value<String>',
            Default: 'ParameterName',
          },
        },
      },
    }),
    hotswap: HotswapMode.FALL_BACK,
    usePreviousParameters: true,
  });

  // THEN
  expect(tryHotswapDeployment).toHaveBeenCalledWith(
    expect.anything(),
    expect.anything(),
    { SomeParameter: 'SomeValue' },
    expect.anything(),
    expect.anything(),
    HotswapMode.FALL_BACK,
    expect.anything(),
  );
});

test('call CreateStack when method=direct and the stack doesnt exist yet', async () => {
  // WHEN
  await testDeployStack({
    ...standardDeployStackArguments(),
    deploymentMethod: { method: 'direct' },
  });

  // THEN
  expect(mockCloudFormationClient).toHaveReceivedCommand(CreateStackCommand);
});

test('call UpdateStack when method=direct and the stack exists already', async () => {
  // WHEN
  mockCloudFormationClient.on(DescribeStacksCommand).resolves({
    Stacks: [{ ...baseResponse }],
  });

  await testDeployStack({
    ...standardDeployStackArguments(),
    deploymentMethod: { method: 'direct' },
    forceDeployment: true,
  });

  // THEN
  expect(mockCloudFormationClient).toHaveReceivedCommand(UpdateStackCommand);
});

test('method=direct and no updates to be performed', async () => {
  const error = new Error('No updates are to be performed.');
  error.name = 'ValidationError';
  mockCloudFormationClient.on(UpdateStackCommand).rejectsOnce(error);

  // WHEN
  mockCloudFormationClient.on(DescribeStacksCommand).resolves({
    Stacks: [{ ...baseResponse }],
  });

  const ret = await testDeployStack({
    ...standardDeployStackArguments(),
    deploymentMethod: { method: 'direct' },
    forceDeployment: true,
  });

  // THEN
  expect(ret).toEqual(expect.objectContaining({ noOp: true }));
});

test("does not call tryHotswapDeployment() if 'hotswap' is false", async () => {
  // WHEN
  await testDeployStack({
    ...standardDeployStackArguments(),
    hotswap: undefined,
  });

  // THEN
  expect(tryHotswapDeployment).not.toHaveBeenCalled();
});

test("rollback still defaults to enabled even if 'hotswap' is enabled", async () => {
  // WHEN
  await testDeployStack({
    ...standardDeployStackArguments(),
    hotswap: HotswapMode.FALL_BACK,
    rollback: undefined,
  });

  // THEN
  expect(mockCloudFormationClient).not.toHaveReceivedCommandWith(
    ExecuteChangeSetCommand,
    expect.objectContaining({
      DisableRollback: true,
    }),
  );
});

test("rollback defaults to enabled if 'hotswap' is undefined", async () => {
  // WHEN
  await testDeployStack({
    ...standardDeployStackArguments(),
    hotswap: undefined,
    rollback: undefined,
  });

  // THEN
  expect(mockCloudFormationClient).toHaveReceivedCommandTimes(ExecuteChangeSetCommand, 1);
  expect(mockCloudFormationClient).not.toHaveReceivedCommandWith(
    ExecuteChangeSetCommand,
    expect.objectContaining({
      DisableRollback: true,
    }),
  );
});

test('do deploy executable change set with 0 changes', async () => {
  // WHEN
  const ret = await testDeployStack({
    ...standardDeployStackArguments(),
  });

  // THEN
  expect(ret.type === 'did-deploy-stack' && ret.noOp).toBeFalsy();
  expect(mockCloudFormationClient).toHaveReceivedCommand(ExecuteChangeSetCommand);
});

test('correctly passes CFN parameters, ignoring ones with empty values', async () => {
  // WHEN
  await testDeployStack({
    ...standardDeployStackArguments(),
    parameters: {
      A: 'A-value',
      B: 'B=value',
      C: undefined,
      D: '',
    },
  });

  // THEN
  expect(mockCloudFormationClient).toHaveReceivedCommandWith(CreateChangeSetCommand, {
    ...expect.anything,
    Parameters: [
      { ParameterKey: 'A', ParameterValue: 'A-value' },
      { ParameterKey: 'B', ParameterValue: 'B=value' },
    ],
    TemplateBody: expect.any(String),
  } as CreateChangeSetCommandInput);
});

test('reuse previous parameters if requested', async () => {
  // GIVEN
  mockCloudFormationClient.on(DescribeStacksCommand).resolves({
    Stacks: [
      {
        ...baseResponse,
        Parameters: [
          { ParameterKey: 'HasValue', ParameterValue: 'TheValue' },
          { ParameterKey: 'HasDefault', ParameterValue: 'TheOldValue' },
        ],
      },
    ],
  });

  // WHEN
  await testDeployStack({
    ...standardDeployStackArguments(),
    stack: FAKE_STACK_WITH_PARAMETERS,
    parameters: {
      OtherParameter: 'SomeValue',
    },
    usePreviousParameters: true,
  });

  // THEN
  expect(mockCloudFormationClient).toHaveReceivedCommandWith(CreateChangeSetCommand, {
    ...expect.anything,
    Parameters: [
      { ParameterKey: 'HasValue', UsePreviousValue: true },
      { ParameterKey: 'HasDefault', UsePreviousValue: true },
      { ParameterKey: 'OtherParameter', ParameterValue: 'SomeValue' },
    ],
  } as CreateChangeSetCommandInput);
});

test('do not reuse previous parameters if not requested', async () => {
  // GIVEN
  mockCloudFormationClient.on(DescribeStacksCommand).resolves({
    Stacks: [
      {
        ...baseResponse,
        Parameters: [
          { ParameterKey: 'HasValue', ParameterValue: 'TheValue' },
          { ParameterKey: 'HasDefault', ParameterValue: 'TheOldValue' },
        ],
      },
    ],
  });

  // WHEN
  await testDeployStack({
    ...standardDeployStackArguments(),
    stack: FAKE_STACK_WITH_PARAMETERS,
    parameters: {
      HasValue: 'SomeValue',
      OtherParameter: 'SomeValue',
    },
  });

  // THEN
  expect(mockCloudFormationClient).toHaveReceivedCommandWith(CreateChangeSetCommand, {
    ...expect.anything,
    ChangeSetType: ChangeSetType.UPDATE,
    Parameters: [
      { ParameterKey: 'HasValue', ParameterValue: 'SomeValue' },
      { ParameterKey: 'OtherParameter', ParameterValue: 'SomeValue' },
    ],
  } as CreateChangeSetCommandInput);
});

test('throw exception if not enough parameters supplied', async () => {
  // GIVEN
  mockCloudFormationClient.on(DescribeStacksCommand).resolves({
    Stacks: [
      {
        ...baseResponse,
        Parameters: [
          { ParameterKey: 'HasValue', ParameterValue: 'TheValue' },
          { ParameterKey: 'HasDefault', ParameterValue: 'TheOldValue' },
        ],
      },
    ],
  });

  // WHEN
  await expect(
    testDeployStack({
      ...standardDeployStackArguments(),
      stack: FAKE_STACK_WITH_PARAMETERS,
      parameters: {
        OtherParameter: 'SomeValue',
      },
    }),
  ).rejects.toThrow(/CloudFormation Parameters are missing a value/);
});

test('deploy is skipped if template did not change', async () => {
  // GIVEN
  mockCloudFormationClient.on(DescribeStacksCommand).resolves({
    Stacks: [
      {
        ...baseResponse,
      },
    ],
  });

  // WHEN
  await testDeployStack({
    ...standardDeployStackArguments(),
  });

  // THEN
  expect(mockCloudFormationClient).not.toHaveReceivedCommand(ExecuteChangeSetCommand);
});

test('deploy is skipped if parameters are the same', async () => {
  // GIVEN
  givenTemplateIs(FAKE_STACK_WITH_PARAMETERS.template);
  mockCloudFormationClient.on(DescribeStacksCommand).resolves({
    Stacks: [
      {
        ...baseResponse,
        Parameters: [
          { ParameterKey: 'HasValue', ParameterValue: 'TheValue' },
          { ParameterKey: 'HasDefault', ParameterValue: 'TheOldValue' },
          { ParameterKey: 'OtherParameter', ParameterValue: 'OtherParameter' },
        ],
      },
    ],
  });

  // WHEN
  await testDeployStack({
    ...standardDeployStackArguments(),
    stack: FAKE_STACK_WITH_PARAMETERS,
    parameters: {},
    usePreviousParameters: true,
  });

  // THEN
  expect(mockCloudFormationClient).not.toHaveReceivedCommand(CreateChangeSetCommand);
});

test('deploy is not skipped if parameters are different', async () => {
  // GIVEN
  givenTemplateIs(FAKE_STACK_WITH_PARAMETERS.template);
  mockCloudFormationClient.on(DescribeStacksCommand).resolves({
    Stacks: [
      {
        ...baseResponse,
        Parameters: [
          { ParameterKey: 'HasValue', ParameterValue: 'TheValue' },
          { ParameterKey: 'HasDefault', ParameterValue: 'TheOldValue' },
          { ParameterKey: 'OtherParameter', ParameterValue: 'OtherParameter' },
        ],
      },
    ],
  });

  // WHEN
  await testDeployStack({
    ...standardDeployStackArguments(),
    stack: FAKE_STACK_WITH_PARAMETERS,
    parameters: {
      HasValue: 'NewValue',
    },
    usePreviousParameters: true,
  });

  // THEN
  expect(mockCloudFormationClient).toHaveReceivedCommandWith(CreateChangeSetCommand, {
    ...expect.anything,
    ChangeSetType: ChangeSetType.UPDATE,
    Parameters: [
      { ParameterKey: 'HasValue', ParameterValue: 'NewValue' },
      { ParameterKey: 'HasDefault', UsePreviousValue: true },
      { ParameterKey: 'OtherParameter', UsePreviousValue: true },
    ],
  } as CreateChangeSetCommandInput);
});

test('deploy is skipped if notificationArns are the same', async () => {
  // GIVEN
  givenTemplateIs(FAKE_STACK.template);
  givenStackExists({
    NotificationARNs: ['arn:aws:sns:bermuda-triangle-1337:123456789012:TestTopic'],
  });

  // WHEN
  await testDeployStack({
    ...standardDeployStackArguments(),
    stack: FAKE_STACK,
    notificationArns: ['arn:aws:sns:bermuda-triangle-1337:123456789012:TestTopic'],
  });

  // THEN
  expect(mockCloudFormationClient).not.toHaveReceivedCommand(CreateChangeSetCommand);
});

test('deploy is not skipped if notificationArns are different', async () => {
  // GIVEN
  givenTemplateIs(FAKE_STACK.template);
  givenStackExists({
    NotificationARNs: ['arn:aws:sns:bermuda-triangle-1337:123456789012:TestTopic'],
  });

  // WHEN
  await testDeployStack({
    ...standardDeployStackArguments(),
    stack: FAKE_STACK,
    notificationArns: ['arn:aws:sns:bermuda-triangle-1337:123456789012:MagicTopic'],
  });

  // THEN
  expect(mockCloudFormationClient).toHaveReceivedCommand(CreateChangeSetCommand);
});

test('if existing stack failed to create, it is deleted and recreated', async () => {
  // GIVEN
  mockCloudFormationClient
    .on(DescribeStacksCommand)
    .resolvesOnce({
      Stacks: [
        {
          ...baseResponse,
          StackStatus: StackStatus.ROLLBACK_COMPLETE,
        },
      ],
    })
    .resolvesOnce({
      Stacks: [
        {
          ...baseResponse,
          StackStatus: StackStatus.DELETE_COMPLETE,
        },
      ],
    })
    .resolves({
      Stacks: [
        {
          ...baseResponse,
          StackStatus: StackStatus.CREATE_COMPLETE,
        },
      ],
    });
  givenTemplateIs({
    DifferentThan: 'TheDefault',
  });

  // WHEN
  await testDeployStack({
    ...standardDeployStackArguments(),
  });

  // THEN
  expect(mockCloudFormationClient).toHaveReceivedCommand(DeleteStackCommand);
  expect(mockCloudFormationClient).toHaveReceivedCommandWith(CreateChangeSetCommand, {
    ...expect.anything,
    ChangeSetType: ChangeSetType.CREATE,
  } as CreateChangeSetCommandInput);
});

test('if existing stack failed to create, it is deleted and recreated even if the template did not change', async () => {
  // GIVEN
  mockCloudFormationClient
    .on(DescribeStacksCommand)
    .resolvesOnce({
      Stacks: [
        {
          ...baseResponse,
          StackStatus: StackStatus.ROLLBACK_COMPLETE,
        },
      ],
    })
    .resolvesOnce({
      Stacks: [
        {
          ...baseResponse,
          StackStatus: StackStatus.DELETE_COMPLETE,
        },
      ],
    })
    .resolves({
      Stacks: [
        {
          ...baseResponse,
          StackStatus: StackStatus.CREATE_COMPLETE,
        },
      ],
    });

  // WHEN
  await testDeployStack({
    ...standardDeployStackArguments(),
  });

  // THEN
  expect(mockCloudFormationClient).toHaveReceivedCommand(DeleteStackCommand);
  expect(mockCloudFormationClient).toHaveReceivedCommandWith(CreateChangeSetCommand, {
    ...expect.anything,
    ChangeSetType: ChangeSetType.CREATE,
  } as CreateChangeSetCommandInput);
});

test('deploy not skipped if template did not change and --force is applied', async () => {
  // GIVEN
  mockCloudFormationClient.on(DescribeStacksCommand).resolves({
    Stacks: [{ ...baseResponse }],
  });

  // WHEN
  await testDeployStack({
    ...standardDeployStackArguments(),
    forceDeployment: true,
  });

  // THEN
  expect(mockCloudFormationClient).toHaveReceivedCommandTimes(ExecuteChangeSetCommand, 1);
});

test('deploy is skipped if template and tags did not change', async () => {
  // GIVEN
  mockCloudFormationClient.on(DescribeStacksCommand).resolves({
    Stacks: [
      {
        ...baseResponse,
        Tags: [
          { Key: 'Key1', Value: 'Value1' },
          { Key: 'Key2', Value: 'Value2' },
        ],
      },
    ],
  });

  // WHEN
  await testDeployStack({
    ...standardDeployStackArguments(),
    tags: [
      { Key: 'Key1', Value: 'Value1' },
      { Key: 'Key2', Value: 'Value2' },
    ],
  });

  // THEN
  expect(mockCloudFormationClient).not.toHaveReceivedCommand(CreateChangeSetCommand);
  expect(mockCloudFormationClient).not.toHaveReceivedCommand(ExecuteChangeSetCommand);
  expect(mockCloudFormationClient).toHaveReceivedCommandWith(DescribeStacksCommand, {
    StackName: 'withouterrors',
  });
  expect(mockCloudFormationClient).toHaveReceivedCommandWith(GetTemplateCommand, {
    StackName: 'withouterrors',
    TemplateStage: 'Original',
  });
});

test('deploy not skipped if template did not change but tags changed', async () => {
  // GIVEN
  givenStackExists({
    Tags: [{ Key: 'Key', Value: 'Value' }],
  });

  // WHEN
  const resolvedEnvironment = mockResolvedEnvironment();
  await testDeployStack({
    stack: FAKE_STACK,
    sdk,
    sdkProvider,
    resolvedEnvironment,
    tags: [
      {
        Key: 'Key',
        Value: 'NewValue',
      },
    ],
    envResources: new NoBootstrapStackEnvironmentResources(resolvedEnvironment, sdk, ioHelper),
  });

  // THEN
  expect(mockCloudFormationClient).toHaveReceivedCommand(CreateChangeSetCommand);
  expect(mockCloudFormationClient).toHaveReceivedCommand(ExecuteChangeSetCommand);
  expect(mockCloudFormationClient).toHaveReceivedCommand(DescribeChangeSetCommand);
  expect(mockCloudFormationClient).toHaveReceivedCommandWith(DescribeStacksCommand, {
    StackName: 'withouterrors',
  });
  expect(mockCloudFormationClient).toHaveReceivedCommandWith(GetTemplateCommand, {
    StackName: 'withouterrors',
    TemplateStage: 'Original',
  });
});

test('deployStack reports no change if describeChangeSet returns specific error', async () => {
  mockCloudFormationClient.on(DescribeChangeSetCommand).resolvesOnce({
    Status: ChangeSetStatus.FAILED,
    StatusReason: 'No updates are to be performed.',
  });

  // WHEN
  const deployResult = await testDeployStack({
    ...standardDeployStackArguments(),
  });

  // THEN
  expect(deployResult.type === 'did-deploy-stack' && deployResult.noOp).toEqual(true);
});

test('deploy not skipped if template did not change but one tag removed', async () => {
  // GIVEN
  mockCloudFormationClient.on(DescribeStacksCommand).resolves({
    Stacks: [
      {
        ...baseResponse,
        Tags: [
          { Key: 'Key1', Value: 'Value1' },
          { Key: 'Key2', Value: 'Value2' },
        ],
      },
    ],
  });

  // WHEN
  await testDeployStack({
    ...standardDeployStackArguments(),
    tags: [{ Key: 'Key1', Value: 'Value1' }],
  });

  // THEN
  expect(mockCloudFormationClient).toHaveReceivedCommand(CreateChangeSetCommand);
  expect(mockCloudFormationClient).toHaveReceivedCommand(ExecuteChangeSetCommand);
  expect(mockCloudFormationClient).toHaveReceivedCommand(DescribeChangeSetCommand);
  expect(mockCloudFormationClient).toHaveReceivedCommandWith(DescribeStacksCommand, {
    StackName: 'withouterrors',
  });
  expect(mockCloudFormationClient).toHaveReceivedCommandWith(GetTemplateCommand, {
    StackName: 'withouterrors',
    TemplateStage: 'Original',
  });
});

test('deploy is not skipped if stack is in a _FAILED state', async () => {
  // GIVEN
  mockCloudFormationClient.on(DescribeStacksCommand).resolves({
    Stacks: [
      {
        ...baseResponse,
        StackStatus: StackStatus.DELETE_FAILED,
      },
    ],
  });

  // WHEN
  await testDeployStack({
    ...standardDeployStackArguments(),
    usePreviousParameters: true,
  }).catch(() => {
  });

  // THEN
  expect(mockCloudFormationClient).toHaveReceivedCommand(CreateChangeSetCommand);
  expect(mockCloudFormationClient).toHaveReceivedCommand(ExecuteChangeSetCommand);
});

test('existing stack in UPDATE_ROLLBACK_COMPLETE state can be updated', async () => {
  // GIVEN
  mockCloudFormationClient
    .on(DescribeStacksCommand)
    .resolvesOnce({
      Stacks: [
        {
          ...baseResponse,
          StackStatus: StackStatus.UPDATE_ROLLBACK_COMPLETE,
        },
      ],
    })
    .resolves({
      Stacks: [
        {
          ...baseResponse,
          StackStatus: StackStatus.UPDATE_COMPLETE,
        },
      ],
    });
  givenTemplateIs({ changed: 123 });

  // WHEN
  await testDeployStack({
    ...standardDeployStackArguments(),
  });

  // THEN
  expect(mockCloudFormationClient).not.toHaveReceivedCommand(DeleteStackCommand);
  expect(mockCloudFormationClient).toHaveReceivedCommandWith(CreateChangeSetCommand, {
    ...expect.anything,
    ChangeSetType: ChangeSetType.UPDATE,
  } as CreateChangeSetCommandInput);
});

test('deploy not skipped if template changed', async () => {
  // GIVEN
  mockCloudFormationClient.on(DescribeStacksCommand).resolves({
    Stacks: [{ ...baseResponse }],
  });
  givenTemplateIs({ changed: 123 });

  // WHEN
  await testDeployStack({
    ...standardDeployStackArguments(),
  });

  // THEN
  expect(mockCloudFormationClient).toHaveReceivedCommand(CreateChangeSetCommand);
  expect(mockCloudFormationClient).toHaveReceivedCommand(ExecuteChangeSetCommand);
});

test('not executed and no error if --no-execute is given', async () => {
  // WHEN
  await testDeployStack({
    ...standardDeployStackArguments(),
    deploymentMethod: { method: 'change-set', execute: false },
  });

  // THEN
  expect(mockCloudFormationClient).not.toHaveReceivedCommand(ExecuteChangeSetCommand);
});

test('empty change set is deleted if --execute is given', async () => {
  mockCloudFormationClient.on(DescribeChangeSetCommand).resolvesOnce({
    Status: ChangeSetStatus.FAILED,
    StatusReason: 'No updates are to be performed.',
  });

  // GIVEN
  mockCloudFormationClient.on(DescribeStacksCommand).resolves({
    Stacks: [{ ...baseResponse }],
  });

  // WHEN
  await testDeployStack({
    ...standardDeployStackArguments(),
    deploymentMethod: { method: 'change-set', execute: true },
    forceDeployment: true, // Necessary to bypass "skip deploy"
  });

  // THEN
  expect(mockCloudFormationClient).toHaveReceivedCommand(CreateChangeSetCommand);
  expect(mockCloudFormationClient).not.toHaveReceivedCommand(ExecuteChangeSetCommand);

  // the first deletion is for any existing cdk change sets, the second is for the deleting the new empty change set
  expect(mockCloudFormationClient).toHaveReceivedCommandTimes(DeleteChangeSetCommand, 2);
});

test('empty change set is not deleted if --no-execute is given', async () => {
  mockCloudFormationClient.on(DescribeChangeSetCommand).resolvesOnce({
    Status: ChangeSetStatus.FAILED,
    StatusReason: 'No updates are to be performed.',
  });

  // GIVEN
  mockCloudFormationClient.on(DescribeStacksCommand).resolves({
    Stacks: [{ ...baseResponse }],
  });

  // WHEN
  await testDeployStack({
    ...standardDeployStackArguments(),
    deploymentMethod: { method: 'change-set', execute: false },
  });

  // THEN
  expect(mockCloudFormationClient).toHaveReceivedCommand(CreateChangeSetCommand);
  expect(mockCloudFormationClient).not.toHaveReceivedCommand(ExecuteChangeSetCommand);

  // the first deletion is for any existing cdk change sets
  expect(mockCloudFormationClient).toHaveReceivedCommandTimes(DeleteChangeSetCommand, 1);
});

test('use S3 url for stack deployment if present in Stack Artifact', async () => {
  // WHEN
  await testDeployStack({
    ...standardDeployStackArguments(),
    stack: testStack({
      stackName: 'withouterrors',
      properties: {
        stackTemplateAssetObjectUrl: 'https://use-me-use-me/',
      },
    }),
  });

  // THEN
  expect(mockCloudFormationClient).toHaveReceivedCommandWith(CreateChangeSetCommand, {
    ...expect.anything,
    TemplateURL: 'https://use-me-use-me/',
  } as CreateChangeSetCommandInput);
  expect(mockCloudFormationClient).toHaveReceivedCommand(ExecuteChangeSetCommand);
});

test('use REST API S3 url with substituted placeholders if manifest url starts with s3://', async () => {
  // WHEN
  await testDeployStack({
    ...standardDeployStackArguments(),
    stack: testStack({
      stackName: 'withouterrors',
      properties: {
        stackTemplateAssetObjectUrl: 's3://use-me-use-me-${AWS::AccountId}/object',
      },
    }),
  });

  // THEN
  expect(mockCloudFormationClient).toHaveReceivedCommandWith(CreateChangeSetCommand, {
    ...expect.anything,
    TemplateURL: 'https://s3.bermuda-triangle-1337.amazonaws.com/use-me-use-me-123456789/object',
  } as CreateChangeSetCommandInput);
  expect(mockCloudFormationClient).toHaveReceivedCommand(ExecuteChangeSetCommand);
});

test('changeset is created when stack exists in REVIEW_IN_PROGRESS status', async () => {
  // GIVEN
  mockCloudFormationClient.on(DescribeStacksCommand).resolves({
    Stacks: [
      {
        ...baseResponse,
        StackStatus: StackStatus.REVIEW_IN_PROGRESS,
        Tags: [
          { Key: 'Key1', Value: 'Value1' },
          { Key: 'Key2', Value: 'Value2' },
        ],
      },
    ],
  });

  // WHEN
  await testDeployStack({
    ...standardDeployStackArguments(),
    deploymentMethod: { method: 'change-set', execute: false },
  });

  // THEN
  expect(mockCloudFormationClient).toHaveReceivedCommandWith(CreateChangeSetCommand, {
    ...expect.anything,
    ChangeSetType: ChangeSetType.CREATE,
    StackName: 'withouterrors',
  } as CreateChangeSetCommandInput);
  expect(mockCloudFormationClient).not.toHaveReceivedCommand(ExecuteChangeSetCommand);
});

test('changeset is updated when stack exists in CREATE_COMPLETE status', async () => {
  // GIVEN
  mockCloudFormationClient.on(DescribeStacksCommand).resolves({
    Stacks: [
      {
        ...baseResponse,
        Tags: [
          { Key: 'Key1', Value: 'Value1' },
          { Key: 'Key2', Value: 'Value2' },
        ],
      },
    ],
  });

  // WHEN
  await testDeployStack({
    ...standardDeployStackArguments(),
    deploymentMethod: { method: 'change-set', execute: false },
  });

  // THEN
  expect(mockCloudFormationClient).toHaveReceivedCommandWith(CreateChangeSetCommand, {
    ...expect.anything,
    ChangeSetType: ChangeSetType.UPDATE,
    StackName: 'withouterrors',
  } as CreateChangeSetCommandInput);
  expect(mockCloudFormationClient).not.toHaveReceivedCommand(ExecuteChangeSetCommand);
});

test('deploy with termination protection enabled', async () => {
  // WHEN
  await testDeployStack({
    ...standardDeployStackArguments(),
    stack: FAKE_STACK_TERMINATION_PROTECTION,
  });

  // THEN
  expect(mockCloudFormationClient).toHaveReceivedCommandWith(UpdateTerminationProtectionCommand, {
    StackName: 'termination-protection',
    EnableTerminationProtection: true,
  });
});

test('updateTerminationProtection not called when termination protection is undefined', async () => {
  // WHEN
  await testDeployStack({
    ...standardDeployStackArguments(),
  });

  // THEN
  expect(mockCloudFormationClient).not.toHaveReceivedCommand(UpdateTerminationProtectionCommand);
});

test('updateTerminationProtection called when termination protection is undefined and stack has termination protection', async () => {
  // GIVEN
  mockCloudFormationClient.on(DescribeStacksCommand).resolves({
    Stacks: [
      {
        ...baseResponse,
        EnableTerminationProtection: true,
      },
    ],
  });

  // WHEN
  await testDeployStack({
    ...standardDeployStackArguments(),
  });

  // THEN
  expect(mockCloudFormationClient).toHaveReceivedCommandWith(UpdateTerminationProtectionCommand, {
    StackName: 'withouterrors',
    EnableTerminationProtection: false,
  });
});

describe('disable rollback', () => {
  test('by default, we do not disable rollback (and also do not pass the flag)', async () => {
    // WHEN
    await testDeployStack({
      ...standardDeployStackArguments(),
    });

    // THEN
    expect(mockCloudFormationClient).toHaveReceivedCommandTimes(ExecuteChangeSetCommand, 1);
    expect(mockCloudFormationClient).not.toHaveReceivedCommandWith(ExecuteChangeSetCommand, {
      DisableRollback: expect.anything,
      ChangeSetName: expect.any(String),
    });
  });

  test('rollback can be disabled by setting rollback: false', async () => {
    // WHEN
    await testDeployStack({
      ...standardDeployStackArguments(),
      rollback: false,
    });

    // THEN
    expect(mockCloudFormationClient).toHaveReceivedCommandWith(ExecuteChangeSetCommand, {
      ...expect.anything,
      DisableRollback: true,
    } as ExecuteChangeSetCommandInput);
  });
});

describe('import-existing-resources', () => {
  test('is disabled by default', async () => {
    // WHEN
    await testDeployStack({
      ...standardDeployStackArguments(),
      deploymentMethod: {
        method: 'change-set',
      },
    });

    // THEN
    expect(mockCloudFormationClient).toHaveReceivedCommandWith(CreateChangeSetCommand, {
      ...expect.anything,
      ImportExistingResources: false,
    } as CreateChangeSetCommandInput);
  });

  test('is added to the CreateChangeSetCommandInput', async () => {
    // WHEN
    await testDeployStack({
      ...standardDeployStackArguments(),
      deploymentMethod: {
        method: 'change-set',
        importExistingResources: true,
      },
    });

    // THEN
    expect(mockCloudFormationClient).toHaveReceivedCommandWith(CreateChangeSetCommand, {
      ...expect.anything,
      ImportExistingResources: true,
    } as CreateChangeSetCommandInput);
  });
});

test.each([
  // From a failed state, a --no-rollback is possible as long as there is not a replacement
  [StackStatus.UPDATE_FAILED, 'no-rollback', 'no-replacement', 'did-deploy-stack'],
  [StackStatus.UPDATE_FAILED, 'no-rollback', 'replacement', 'failpaused-need-rollback-first'],
  // Any combination of UPDATE_FAILED & rollback always requires a rollback first
  [StackStatus.UPDATE_FAILED, 'rollback', 'replacement', 'failpaused-need-rollback-first'],
  [StackStatus.UPDATE_FAILED, 'rollback', 'no-replacement', 'failpaused-need-rollback-first'],
  // From a stable state, any deployment containing a replacement requires a regular deployment (--rollback)
  [StackStatus.UPDATE_COMPLETE, 'no-rollback', 'replacement', 'replacement-requires-rollback'],
] satisfies Array<[StackStatus, 'rollback' | 'no-rollback', 'replacement' | 'no-replacement', string]>)
('no-rollback and replacement is disadvised: %s %s %s -> %s', async (stackStatus, rollback, replacement, expectedType) => {
  // GIVEN
  givenTemplateIs(FAKE_STACK.template);
  givenStackExists({
    // First call
    StackStatus: stackStatus,
  }, {
    // Later calls
    StackStatus: 'UPDATE_COMPLETE',
  });
  givenChangeSetContainsReplacement(replacement === 'replacement');

  // WHEN
  const result = await testDeployStack({
    ...standardDeployStackArguments(),
    stack: FAKE_STACK,
    rollback: rollback === 'rollback',
    forceDeployment: true, // Bypass 'canSkipDeploy'
  });

  // THEN
  expect(result.type).toEqual(expectedType);
});

test('assertIsSuccessfulDeployStackResult does what it says', () => {
  expect(() => assertIsSuccessfulDeployStackResult({ type: 'replacement-requires-rollback' })).toThrow();
});
/**
 * Set up the mocks so that it looks like the stack exists to start with
 *
 * The last element of this array will be continuously repeated.
 */
function givenStackExists(...overrides: Array<Partial<Stack>>) {
  if (overrides.length === 0) {
    overrides = [{}];
  }

  let handler = mockCloudFormationClient.on(DescribeStacksCommand);

  for (const override of overrides.slice(0, overrides.length - 1)) {
    handler = handler.resolvesOnce({
      Stacks: [{ ...baseResponse, ...override }],
    });
  }
  handler.resolves({
    Stacks: [{ ...baseResponse, ...overrides[overrides.length - 1] }],
  });
}

function givenTemplateIs(template: any) {
  mockCloudFormationClient.on(GetTemplateCommand).resolves({
    TemplateBody: JSON.stringify(template),
  });
}

function givenChangeSetContainsReplacement(replacement: boolean) {
  mockCloudFormationClient.on(DescribeChangeSetCommand).resolves({
    Status: 'CREATE_COMPLETE',
    Changes: replacement ? [
      {
        Type: 'Resource',
        ResourceChange: {
          PolicyAction: 'ReplaceAndDelete',
          Action: 'Modify',
          LogicalResourceId: 'Queue4A7E3555',
          PhysicalResourceId: 'https://sqs.eu-west-1.amazonaws.com/111111111111/Queue4A7E3555-P9C8nK3uv8v6.fifo',
          ResourceType: 'AWS::SQS::Queue',
          Replacement: 'True',
          Scope: ['Properties'],
          Details: [
            {
              Target: {
                Attribute: 'Properties',
                Name: 'FifoQueue',
                RequiresRecreation: 'Always',
              },
              Evaluation: 'Static',
              ChangeSource: 'DirectModification',
            },
          ],
        },
      },
    ] : [],
  });
}

describe('executing existing change sets', () => {
  test('can execute an existing change set', async () => {
    // GIVEN
    const existingChangeSetName = 'existing-change-set';
    givenStackExists();
    mockCloudFormationClient.on(DescribeChangeSetCommand).resolves({
      ChangeSetId: 'arn:aws:cloudformation:us-east-1:123456789012:changeSet/existing-change-set/12345678-1234-1234-1234-123456789012',
      ChangeSetName: existingChangeSetName,
      StackId: 'arn:aws:cloudformation:us-east-1:123456789012:stack/withouterrors/12345678-1234-1234-1234-123456789012',
      Status: 'CREATE_COMPLETE',
      Changes: [
        {
          Type: 'Resource',
          ResourceChange: {
            Action: 'Modify',
            LogicalResourceId: 'TestResource',
            ResourceType: 'AWS::S3::Bucket',
          },
        },
      ],
    });
    mockCloudFormationClient.on(ExecuteChangeSetCommand).resolves({});
    const resolvedEnvironment = mockResolvedEnvironment();

    // WHEN
    const result = await testDeployStack({
      stack: FAKE_STACK,
      resolvedEnvironment,
      sdk: new MockSdk(),
      sdkProvider: new MockSdkProvider(),
      envResources: new NoBootstrapStackEnvironmentResources(resolvedEnvironment, sdk, ioHelper),
      deploymentMethod: {
        method: 'change-set',
        executeExistingChangeSet: true,
        changeSetName: existingChangeSetName,
        execute: true,
      },
    });

    // THEN
    expect(result).toEqual(expect.objectContaining({ type: 'did-deploy-stack', noOp: false }));
    expect(mockCloudFormationClient).toHaveReceivedCommandWith(DescribeChangeSetCommand, {
      StackName: 'withouterrors',
      ChangeSetName: existingChangeSetName,
    });
    expect(mockCloudFormationClient).toHaveReceivedCommandWith(ExecuteChangeSetCommand, {
      StackName: 'withouterrors',
      ChangeSetName: existingChangeSetName,
      ClientRequestToken: expect.stringMatching(/^exec/),
    });
    // Should not create a new change set
    expect(mockCloudFormationClient).not.toHaveReceivedCommand(CreateChangeSetCommand);
  });

  test('throws error when existing change set is not found', async () => {
    // GIVEN
    const nonExistentChangeSetName = 'non-existent-change-set';
    givenStackExists();
    mockCloudFormationClient.on(DescribeChangeSetCommand).resolves({
      // Empty response simulating change set not found
    });
    const resolvedEnvironment = mockResolvedEnvironment();

    // WHEN
    const result = testDeployStack({
      stack: FAKE_STACK,
      resolvedEnvironment,
      sdk: new MockSdk(),
      sdkProvider: new MockSdkProvider(),
      envResources: new NoBootstrapStackEnvironmentResources(resolvedEnvironment, sdk, ioHelper),
      deploymentMethod: {
        method: 'change-set',
        executeExistingChangeSet: true,
        changeSetName: nonExistentChangeSetName,
        execute: true,
      },
    });

    // THEN
    await expect(result).rejects.toThrow(`Change set ${nonExistentChangeSetName} not found on stack withouterrors`);
  });

  test('throws error when existing change set is not in valid state', async () => {
    // GIVEN
    const invalidChangeSetName = 'invalid-change-set';
    givenStackExists();
    mockCloudFormationClient.on(DescribeChangeSetCommand).resolves({
      ChangeSetId: 'arn:aws:cloudformation:us-east-1:123456789012:changeSet/invalid-change-set/12345678-1234-1234-1234-123456789012',
      ChangeSetName: invalidChangeSetName,
      StackId: 'arn:aws:cloudformation:us-east-1:123456789012:stack/withouterrors/12345678-1234-1234-1234-123456789012',
      Status: 'FAILED',
    });
    const resolvedEnvironment = mockResolvedEnvironment();

    // WHEN
    const result = testDeployStack({
      stack: FAKE_STACK,
      resolvedEnvironment,
      sdk: new MockSdk(),
      sdkProvider: new MockSdkProvider(),
      envResources: new NoBootstrapStackEnvironmentResources(resolvedEnvironment, sdk, ioHelper),
      deploymentMethod: {
        method: 'change-set',
        executeExistingChangeSet: true,
        changeSetName: invalidChangeSetName,
        execute: true,
      },
    });

    // THEN
    await expect(result).rejects.toThrow(`Change set ${invalidChangeSetName} is in status FAILED and cannot be executed`);
  });

  test('works with change set in different status', async () => {
    // GIVEN
    const existingChangeSetName = 'pending-changeset';
    givenStackExists();
    mockCloudFormationClient.on(DescribeChangeSetCommand).resolves({
      ChangeSetId: 'arn:aws:cloudformation:us-east-1:123456789012:changeSet/pending-changeset/12345678-1234-1234-1234-123456789012',
      ChangeSetName: existingChangeSetName,
      StackId: 'arn:aws:cloudformation:us-east-1:123456789012:stack/withouterrors/12345678-1234-1234-1234-123456789012',
      Status: 'CREATE_COMPLETE', // Valid status for execution
      Changes: [
        {
          Type: 'Resource',
          ResourceChange: {
            Action: 'Add',
            LogicalResourceId: 'NewResource',
            ResourceType: 'AWS::S3::Bucket',
          },
        },
      ],
    });
    mockCloudFormationClient.on(ExecuteChangeSetCommand).resolves({});
    const resolvedEnvironment = mockResolvedEnvironment();

    // WHEN
    const result = await testDeployStack({
      stack: FAKE_STACK,
      resolvedEnvironment,
      sdk: new MockSdk(),
      sdkProvider: new MockSdkProvider(),
      envResources: new NoBootstrapStackEnvironmentResources(resolvedEnvironment, sdk, ioHelper),
      deploymentMethod: {
        method: 'change-set',
        executeExistingChangeSet: true,
        changeSetName: existingChangeSetName,
        execute: true,
      },
    });

    // THEN
    expect(result).toEqual(expect.objectContaining({ type: 'did-deploy-stack', noOp: false }));
    expect(mockCloudFormationClient).toHaveReceivedCommandWith(ExecuteChangeSetCommand, {
      StackName: 'withouterrors',
      ChangeSetName: existingChangeSetName,
      ClientRequestToken: expect.stringMatching(/^exec/),
    });
  });

  test('executeExistingChangeSet with execute false does not execute', async () => {
    // GIVEN
    const existingChangeSetName = 'review-changeset';
    givenStackExists();
    mockCloudFormationClient.on(DescribeChangeSetCommand).resolves({
      ChangeSetId: 'arn:aws:cloudformation:us-east-1:123456789012:changeSet/review-changeset/12345678-1234-1234-1234-123456789012',
      ChangeSetName: existingChangeSetName,
      StackId: 'arn:aws:cloudformation:us-east-1:123456789012:stack/withouterrors/12345678-1234-1234-1234-123456789012',
      Status: 'CREATE_COMPLETE',
      Changes: [
        {
          Type: 'Resource',
          ResourceChange: {
            Action: 'Modify',
            LogicalResourceId: 'TestResource',
            ResourceType: 'AWS::S3::Bucket',
          },
        },
      ],
    });
    const resolvedEnvironment = mockResolvedEnvironment();

    // WHEN
    const result = await testDeployStack({
      stack: FAKE_STACK,
      resolvedEnvironment,
      sdk: new MockSdk(),
      sdkProvider: new MockSdkProvider(),
      envResources: new NoBootstrapStackEnvironmentResources(resolvedEnvironment, sdk, ioHelper),
      deploymentMethod: {
        method: 'change-set',
        executeExistingChangeSet: true,
        changeSetName: existingChangeSetName,
        execute: false, // Don't execute, just describe
      },
    });

    // THEN
    expect(result).toEqual(expect.objectContaining({ type: 'did-deploy-stack', noOp: false }));
    expect(mockCloudFormationClient).toHaveReceivedCommandWith(DescribeChangeSetCommand, {
      StackName: 'withouterrors',
      ChangeSetName: existingChangeSetName,
    });
    // Should NOT execute the change set
    expect(mockCloudFormationClient).not.toHaveReceivedCommand(ExecuteChangeSetCommand);
  });
});
