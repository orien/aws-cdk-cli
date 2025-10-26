import type * as cxapi from '@aws-cdk/cx-api';
import * as make from './message-maker';
import type { SpanDefinition } from './span';
import type { StackDiff, DiffResult } from '../../../payloads';
import type { BootstrapEnvironmentProgress } from '../../../payloads/bootstrap-environment-progress';
import type { MissingContext, UpdatedContext } from '../../../payloads/context';
import type { BuildAsset, DeployConfirmationRequest, PublishAsset, StackDeployProgress, SuccessfulDeployStackResult } from '../../../payloads/deploy';
import type { StackDestroy, StackDestroyProgress } from '../../../payloads/destroy';
import type { DriftResultPayload } from '../../../payloads/drift';
import type { FeatureFlagChangeRequest } from '../../../payloads/flags';
import type { AssetBatchDeletionRequest } from '../../../payloads/gc';
import type { HotswapDeploymentDetails, HotswapDeploymentAttempt, HotswappableChange, HotswapResult } from '../../../payloads/hotswap';
import type { ResourceIdentificationRequest, ResourceImportRequest } from '../../../payloads/import';
import type { StackDetailsPayload } from '../../../payloads/list';
import type { CloudWatchLogEvent, CloudWatchLogMonitorControlEvent } from '../../../payloads/logs-monitor';
import type { RefactorResult } from '../../../payloads/refactor';
import type { StackRollbackProgress } from '../../../payloads/rollback';
import type { MfaTokenRequest, SdkTrace } from '../../../payloads/sdk';
import type { StackActivity, StackMonitoringControlEvent } from '../../../payloads/stack-activity';
import type { StackSelectionDetails } from '../../../payloads/synth';
import type {
  AssemblyData,
  ConfirmationRequest,
  ContextProviderMessageSource,
  Duration,
  ErrorPayload,
  SingleStack,
  StackAndAssemblyData,
} from '../../../payloads/types';
import type { FileWatchEvent, WatchSettings } from '../../../payloads/watch';

/**
 * We have a rough system by which we assign message codes:
 * - First digit groups messages by action, e.g. synth or deploy
 * - X000-X009 are reserved for timings
 * - X900-X999 are reserved for results
 */
export const IO = {
  // warnings & errors
  CDK_TOOLKIT_W0100: make.warn({
    code: 'CDK_TOOLKIT_W0100',
    description: 'Credential plugin warnings',
  }),

  // 1: Synth (1xxx)
  CDK_TOOLKIT_I1000: make.info<Duration>({
    code: 'CDK_TOOLKIT_I1000',
    description: 'Provides synthesis times.',
    interface: 'Duration',
  }),
  CDK_TOOLKIT_I1001: make.trace<StackSelectionDetails>({
    code: 'CDK_TOOLKIT_I1001',
    description: 'Cloud Assembly synthesis is starting',
    interface: 'StackSelectionDetails',
  }),
  CDK_TOOLKIT_I1901: make.result<StackAndAssemblyData>({
    code: 'CDK_TOOLKIT_I1901',
    description: 'Provides stack data',
    interface: 'StackAndAssemblyData',
  }),
  CDK_TOOLKIT_I1902: make.result<AssemblyData>({
    code: 'CDK_TOOLKIT_I1902',
    description: 'Successfully deployed stacks',
    interface: 'AssemblyData',
  }),

  // 2: List (2xxx)
  CDK_TOOLKIT_I2901: make.result<StackDetailsPayload>({
    code: 'CDK_TOOLKIT_I2901',
    description: 'Provides details on the selected stacks and their dependencies',
    interface: 'StackDetailsPayload',
  }),

  // 3: Import & Migrate
  CDK_TOOLKIT_I3100: make.confirm<ResourceImportRequest>({
    code: 'CDK_TOOLKIT_I3100',
    description: 'Confirm the import of a specific resource',
    interface: 'ResourceImportRequest',
  }),
  CDK_TOOLKIT_I3110: make.question<ResourceIdentificationRequest>({
    code: 'CDK_TOOLKIT_I3110',
    description: 'Additional information is needed to identify a resource',
    interface: 'ResourceIdentificationRequest',
  }),
  CDK_TOOLKIT_E3900: make.error<ErrorPayload>({
    code: 'CDK_TOOLKIT_E3900',
    description: 'Resource import failed',
    interface: 'ErrorPayload',
  }),

  // 4: Diff (40xx - 44xx)
  CDK_TOOLKIT_I4000: make.trace<StackSelectionDetails>({
    code: 'CDK_TOOLKIT_I4000',
    description: 'Diff stacks is starting',
    interface: 'StackSelectionDetails',
  }),
  CDK_TOOLKIT_I4001: make.result<DiffResult>({
    code: 'CDK_TOOLKIT_I4001',
    description: 'Output of the diff command',
    interface: 'DiffResult',
  }),
  CDK_TOOLKIT_I4002: make.result<StackDiff>({
    code: 'CDK_TOOLKIT_I4002',
    description: 'The diff for a single stack',
    interface: 'StackDiff',
  }),

  // 4: Drift (45xx - 49xx)
  CDK_TOOLKIT_I4500: make.trace<StackSelectionDetails>({
    code: 'CDK_TOOLKIT_I4500',
    description: 'Drift detection is starting',
    interface: 'StackSelectionDetails',
  }),
  CDK_TOOLKIT_I4509: make.result<Duration>({
    code: 'CDK_TOOLKIT_I4592',
    description: 'Results of the drift',
    interface: 'Duration',
  }),
  CDK_TOOLKIT_I4590: make.result<DriftResultPayload>({
    code: 'CDK_TOOLKIT_I4590',
    description: 'Results of a stack drift',
    interface: 'DriftResultPayload',
  }),
  CDK_TOOLKIT_W4591: make.warn<SingleStack>({
    code: 'CDK_TOOLKIT_W4591',
    description: 'Missing drift result fort a stack.',
    interface: 'SingleStack',
  }),

  // 5: Deploy & Watch (5xxx)
  CDK_TOOLKIT_I5000: make.info<Duration>({
    code: 'CDK_TOOLKIT_I5000',
    description: 'Provides deployment times',
    interface: 'Duration',
  }),
  CDK_TOOLKIT_I5001: make.info<Duration>({
    code: 'CDK_TOOLKIT_I5001',
    description: 'Provides total time in deploy action, including synth and rollback',
    interface: 'Duration',
  }),
  CDK_TOOLKIT_I5002: make.info<Duration>({
    code: 'CDK_TOOLKIT_I5002',
    description: 'Provides time for resource migration',
    interface: 'Duration',
  }),
  CDK_TOOLKIT_W5021: make.warn({
    code: 'CDK_TOOLKIT_W5021',
    description: 'Empty non-existent stack, deployment is skipped',
  }),
  CDK_TOOLKIT_W5022: make.warn({
    code: 'CDK_TOOLKIT_W5022',
    description: 'Empty existing stack, stack will be destroyed',
  }),
  CDK_TOOLKIT_W5023: make.warn({
    code: 'CDK_TOOLKIT_W5023',
    description: 'No changes to existing stack, deployment is skipped',
  }),
  CDK_TOOLKIT_I5031: make.info({
    code: 'CDK_TOOLKIT_I5031',
    description: 'Informs about any log groups that are traced as part of the deployment',
  }),
  CDK_TOOLKIT_I5032: make.debug<CloudWatchLogMonitorControlEvent>({
    code: 'CDK_TOOLKIT_I5032',
    description: 'Start monitoring log groups',
    interface: 'CloudWatchLogMonitorControlEvent',
  }),
  CDK_TOOLKIT_I5033: make.info<CloudWatchLogEvent>({
    code: 'CDK_TOOLKIT_I5033',
    description: 'A log event received from Cloud Watch',
    interface: 'CloudWatchLogEvent',
  }),
  CDK_TOOLKIT_I5034: make.debug<CloudWatchLogMonitorControlEvent>({
    code: 'CDK_TOOLKIT_I5034',
    description: 'Stop monitoring log groups',
    interface: 'CloudWatchLogMonitorControlEvent',
  }),
  CDK_TOOLKIT_E5035: make.error<ErrorPayload>({
    code: 'CDK_TOOLKIT_E5035',
    description: 'A log monitoring error',
    interface: 'ErrorPayload',
  }),
  CDK_TOOLKIT_I5050: make.confirm<ConfirmationRequest>({
    code: 'CDK_TOOLKIT_I5050',
    description: 'Confirm rollback during deployment',
    interface: 'ConfirmationRequest',
  }),
  CDK_TOOLKIT_I5060: make.confirm<DeployConfirmationRequest>({
    code: 'CDK_TOOLKIT_I5060',
    description: 'Confirm deploy changes',
    interface: 'DeployConfirmationRequest',
  }),
  CDK_TOOLKIT_I5100: make.info<StackDeployProgress>({
    code: 'CDK_TOOLKIT_I5100',
    description: 'Stack deploy progress',
    interface: 'StackDeployProgress',
  }),

  // Assets (52xx)
  CDK_TOOLKIT_I5210: make.trace<BuildAsset>({
    code: 'CDK_TOOLKIT_I5210',
    description: 'Started building a specific asset',
    interface: 'BuildAsset',
  }),
  CDK_TOOLKIT_I5211: make.trace<Duration>({
    code: 'CDK_TOOLKIT_I5211',
    description: 'Building the asset has completed',
    interface: 'Duration',
  }),
  CDK_TOOLKIT_I5220: make.trace<PublishAsset>({
    code: 'CDK_TOOLKIT_I5220',
    description: 'Started publishing a specific asset',
    interface: 'PublishAsset',
  }),
  CDK_TOOLKIT_I5221: make.trace<Duration>({
    code: 'CDK_TOOLKIT_I5221',
    description: 'Publishing the asset has completed',
    interface: 'Duration',
  }),

  // Watch (53xx)
  CDK_TOOLKIT_I5310: make.debug<WatchSettings>({
    code: 'CDK_TOOLKIT_I5310',
    description: 'The computed settings used for file watching',
    interface: 'WatchSettings',
  }),
  CDK_TOOLKIT_I5311: make.info<FileWatchEvent>({
    code: 'CDK_TOOLKIT_I5311',
    description: 'File watching started',
    interface: 'FileWatchEvent',
  }),
  CDK_TOOLKIT_I5312: make.info<FileWatchEvent>({
    code: 'CDK_TOOLKIT_I5312',
    description: 'File event detected, starting deployment',
    interface: 'FileWatchEvent',
  }),
  CDK_TOOLKIT_I5313: make.info<FileWatchEvent>({
    code: 'CDK_TOOLKIT_I5313',
    description: 'File event detected during active deployment, changes are queued',
    interface: 'FileWatchEvent',
  }),
  CDK_TOOLKIT_I5314: make.info({
    code: 'CDK_TOOLKIT_I5314',
    description: 'Initial watch deployment started',
  }),
  CDK_TOOLKIT_I5315: make.info({
    code: 'CDK_TOOLKIT_I5315',
    description: 'Queued watch deployment started',
  }),

  // Hotswap (54xx)
  CDK_TOOLKIT_I5400: make.trace<HotswapDeploymentAttempt>({
    code: 'CDK_TOOLKIT_I5400',
    description: 'Attempting a hotswap deployment',
    interface: 'HotswapDeploymentAttempt',
  }),
  CDK_TOOLKIT_I5401: make.trace<HotswapDeploymentDetails>({
    code: 'CDK_TOOLKIT_I5401',
    description: 'Computed details for the hotswap deployment',
    interface: 'HotswapDeploymentDetails',
  }),
  CDK_TOOLKIT_I5402: make.info<HotswappableChange>({
    code: 'CDK_TOOLKIT_I5402',
    description: 'A hotswappable change is processed as part of a hotswap deployment',
    interface: 'HotswappableChange',
  }),
  CDK_TOOLKIT_I5403: make.info<HotswappableChange>({
    code: 'CDK_TOOLKIT_I5403',
    description: 'The hotswappable change has completed processing',
    interface: 'HotswappableChange',
  }),
  CDK_TOOLKIT_I5410: make.info<HotswapResult>({
    code: 'CDK_TOOLKIT_I5410',
    description: 'Hotswap deployment has ended, a full deployment might still follow if needed',
    interface: 'HotswapResult',
  }),

  // Stack Monitor (55xx)
  CDK_TOOLKIT_I5501: make.info<StackMonitoringControlEvent>({
    code: 'CDK_TOOLKIT_I5501',
    description: 'Stack Monitoring: Start monitoring of a single stack',
    interface: 'StackMonitoringControlEvent',
  }),
  CDK_TOOLKIT_I5502: make.info<StackActivity>({
    code: 'CDK_TOOLKIT_I5502',
    description: 'Stack Monitoring: Activity event for a single stack',
    interface: 'StackActivity',
  }),
  CDK_TOOLKIT_I5503: make.info<StackMonitoringControlEvent>({
    code: 'CDK_TOOLKIT_I5503',
    description: 'Stack Monitoring: Finished monitoring of a single stack',
    interface: 'StackMonitoringControlEvent',
  }),

  // Success (59xx)
  CDK_TOOLKIT_I5900: make.result<SuccessfulDeployStackResult>({
    code: 'CDK_TOOLKIT_I5900',
    description: 'Deployment results on success',
    interface: 'SuccessfulDeployStackResult',
  }),
  CDK_TOOLKIT_I5901: make.info({
    code: 'CDK_TOOLKIT_I5901',
    description: 'Generic deployment success messages',
  }),
  CDK_TOOLKIT_W5400: make.warn({
    code: 'CDK_TOOLKIT_W5400',
    description: 'Hotswap disclosure message',
  }),

  CDK_TOOLKIT_E5001: make.error({
    code: 'CDK_TOOLKIT_E5001',
    description: 'No stacks found',
  }),
  CDK_TOOLKIT_E5500: make.error<ErrorPayload>({
    code: 'CDK_TOOLKIT_E5500',
    description: 'Stack Monitoring error',
    interface: 'ErrorPayload',
  }),

  // 6: Rollback (6xxx)
  CDK_TOOLKIT_I6000: make.info<Duration>({
    code: 'CDK_TOOLKIT_I6000',
    description: 'Provides rollback times',
    interface: 'Duration',
  }),
  CDK_TOOLKIT_I6100: make.info<StackRollbackProgress>({
    code: 'CDK_TOOLKIT_I6100',
    description: 'Stack rollback progress',
    interface: 'StackRollbackProgress',
  }),

  CDK_TOOLKIT_E6001: make.error({
    code: 'CDK_TOOLKIT_E6001',
    description: 'No stacks found',
  }),
  CDK_TOOLKIT_E6900: make.error<ErrorPayload>({
    code: 'CDK_TOOLKIT_E6900',
    description: 'Rollback failed',
    interface: 'ErrorPayload',
  }),

  // 7: Destroy (7xxx)
  CDK_TOOLKIT_I7000: make.info<Duration>({
    code: 'CDK_TOOLKIT_I7000',
    description: 'Provides destroy times',
    interface: 'Duration',
  }),
  CDK_TOOLKIT_I7001: make.trace<Duration>({
    code: 'CDK_TOOLKIT_I7001',
    description: 'Provides destroy time for a single stack',
    interface: 'Duration',
  }),
  CDK_TOOLKIT_I7010: make.confirm<ConfirmationRequest>({
    code: 'CDK_TOOLKIT_I7010',
    description: 'Confirm destroy stacks',
    interface: 'ConfirmationRequest',
  }),
  CDK_TOOLKIT_I7100: make.info<StackDestroyProgress>({
    code: 'CDK_TOOLKIT_I7100',
    description: 'Stack destroy progress',
    interface: 'StackDestroyProgress',
  }),
  CDK_TOOLKIT_I7101: make.trace<StackDestroy>({
    code: 'CDK_TOOLKIT_I7101',
    description: 'Start stack destroying',
    interface: 'StackDestroy',
  }),

  CDK_TOOLKIT_I7900: make.result<cxapi.CloudFormationStackArtifact>({
    code: 'CDK_TOOLKIT_I7900',
    description: 'Stack deletion succeeded',
    interface: 'cxapi.CloudFormationStackArtifact',
  }),

  CDK_TOOLKIT_E7010: make.error({
    code: 'CDK_TOOLKIT_E7010',
    description: 'Action was aborted due to negative confirmation of request',
  }),
  CDK_TOOLKIT_E7900: make.error<ErrorPayload>({
    code: 'CDK_TOOLKIT_E7900',
    description: 'Stack deletion failed',
    interface: 'ErrorPayload',
  }),

  // 8. Refactor (8xxx)
  CDK_TOOLKIT_E8900: make.error<ErrorPayload>({
    code: 'CDK_TOOLKIT_E8900',
    description: 'Stack refactor failed',
    interface: 'ErrorPayload',
  }),

  CDK_TOOLKIT_I8900: make.result<RefactorResult>({
    code: 'CDK_TOOLKIT_I8900',
    description: 'Refactor result',
    interface: 'RefactorResult',
  }),

  CDK_TOOLKIT_I8910: make.confirm<ConfirmationRequest>({
    code: 'CDK_TOOLKIT_I8910',
    description: 'Confirm refactor',
    interface: 'ConfirmationRequest',
  }),

  CDK_TOOLKIT_W8010: make.warn({
    code: 'CDK_TOOLKIT_W8010',
    description: 'Refactor execution not yet supported',
  }),

  // 9: Bootstrap  & gc (9xxx)
  CDK_TOOLKIT_I9000: make.info<Duration>({
    code: 'CDK_TOOLKIT_I9000',
    description: 'Provides bootstrap times',
    interface: 'Duration',
  }),
  CDK_TOOLKIT_I9100: make.info<BootstrapEnvironmentProgress>({
    code: 'CDK_TOOLKIT_I9100',
    description: 'Bootstrap progress',
    interface: 'BootstrapEnvironmentProgress',
  }),

  // gc (92xx)
  CDK_TOOLKIT_I9210: make.question<AssetBatchDeletionRequest>({
    code: 'CDK_TOOLKIT_I9210',
    description: 'Confirm the deletion of a batch of assets',
    interface: 'AssetBatchDeletionRequest',
  }),

  CDK_TOOLKIT_I9900: make.result<{ environment: cxapi.Environment }>({
    code: 'CDK_TOOLKIT_I9900',
    description: 'Bootstrap results on success',
    interface: 'cxapi.Environment',
  }),
  CDK_TOOLKIT_E9900: make.error<ErrorPayload>({
    code: 'CDK_TOOLKIT_E9900',
    description: 'Bootstrap failed',
    interface: 'ErrorPayload',
  }),

  // flags (93xxx)
  CDK_TOOLKIT_I9300: make.info<FeatureFlagChangeRequest>({
    code: 'CDK_TOOLKIT_I9300',
    description: 'Confirm the feature flag configuration changes',
    interface: 'FeatureFlagChangeRequest',
  }),

  // Notices
  CDK_TOOLKIT_I0100: make.info({
    code: 'CDK_TOOLKIT_I0100',
    description: 'Notices decoration (the header or footer of a list of notices)',
  }),
  CDK_TOOLKIT_W0101: make.warn({
    code: 'CDK_TOOLKIT_W0101',
    description: 'A notice that is marked as a warning',
  }),
  CDK_TOOLKIT_E0101: make.error({
    code: 'CDK_TOOLKIT_E0101',
    description: 'A notice that is marked as an error',
  }),
  CDK_TOOLKIT_I0101: make.info({
    code: 'CDK_TOOLKIT_I0101',
    description: 'A notice that is marked as informational',
  }),

  // Assembly codes
  CDK_ASSEMBLY_I0010: make.debug({
    code: 'CDK_ASSEMBLY_I0010',
    description: 'Generic environment preparation debug messages',
  }),
  CDK_ASSEMBLY_W0010: make.warn({
    code: 'CDK_ASSEMBLY_W0010',
    description: 'Emitted if the found framework version does not support context overflow',
  }),
  CDK_ASSEMBLY_I0042: make.debug<UpdatedContext>({
    code: 'CDK_ASSEMBLY_I0042',
    description: 'Writing context updates',
    interface: 'UpdatedContext',
  }),
  CDK_ASSEMBLY_I0240: make.debug<MissingContext>({
    code: 'CDK_ASSEMBLY_I0240',
    description: 'Context lookup was stopped as no further progress was made. ',
    interface: 'MissingContext',
  }),
  CDK_ASSEMBLY_I0241: make.debug<MissingContext>({
    code: 'CDK_ASSEMBLY_I0241',
    description: 'Fetching missing context. This is an iterative message that may appear multiple times with different missing keys.',
    interface: 'MissingContext',
  }),
  CDK_ASSEMBLY_I1000: make.debug({
    code: 'CDK_ASSEMBLY_I1000',
    description: 'Cloud assembly output starts',
  }),
  CDK_ASSEMBLY_I1001: make.info({
    code: 'CDK_ASSEMBLY_I1001',
    description: 'Output lines emitted by the cloud assembly to stdout',
  }),
  CDK_ASSEMBLY_E1002: make.error({
    code: 'CDK_ASSEMBLY_E1002',
    description: 'Output lines emitted by the cloud assembly to stderr',
  }),
  CDK_ASSEMBLY_I1003: make.info({
    code: 'CDK_ASSEMBLY_I1003',
    description: 'Cloud assembly output finished',
  }),
  CDK_ASSEMBLY_E1111: make.error<ErrorPayload>({
    code: 'CDK_ASSEMBLY_E1111',
    description: 'Incompatible CDK CLI version. Upgrade needed.',
    interface: 'ErrorPayload',
  }),

  CDK_ASSEMBLY_I0150: make.debug<never>({
    code: 'CDK_ASSEMBLY_I0150',
    description: 'Indicates the use of a pre-synthesized cloud assembly directory',
  }),

  CDK_ASSEMBLY_I0300: make.info<ContextProviderMessageSource>({
    code: 'CDK_ASSEMBLY_I0300',
    description: 'An info message emitted by a Context Provider',
    interface: 'ContextProviderMessageSource',
  }),
  CDK_ASSEMBLY_I0301: make.debug<ContextProviderMessageSource>({
    code: 'CDK_ASSEMBLY_I0301',
    description: 'A debug message emitted by a Context Provider',
    interface: 'ContextProviderMessageSource',
  }),

  // Assembly Annotations
  CDK_ASSEMBLY_I9999: make.info<cxapi.SynthesisMessage>({
    code: 'CDK_ASSEMBLY_I9999',
    description: 'Annotations emitted by the cloud assembly',
    interface: 'cxapi.SynthesisMessage',
  }),
  CDK_ASSEMBLY_W9999: make.warn<cxapi.SynthesisMessage>({
    code: 'CDK_ASSEMBLY_W9999',
    description: 'Warnings emitted by the cloud assembly',
    interface: 'cxapi.SynthesisMessage',
  }),
  CDK_ASSEMBLY_E9999: make.error<cxapi.SynthesisMessage>({
    code: 'CDK_ASSEMBLY_E9999',
    description: 'Errors emitted by the cloud assembly',
    interface: 'cxapi.SynthesisMessage',
  }),

  // SDK codes
  CDK_SDK_I0100: make.trace<SdkTrace>({
    code: 'CDK_SDK_I0100',
    description: 'An SDK trace. SDK traces are emitted as traces to the IoHost, but contain the original SDK logging level.',
    interface: 'SdkTrace',
  }),
  CDK_SDK_I1100: make.question<MfaTokenRequest>({
    code: 'CDK_SDK_I1100',
    description: 'Get an MFA token for an MFA device.',
    interface: 'MfaTokenRequest',
  }),
};

//////////////////////////////////////////////////////////////////////////////////////////

/**
 * Payload type of the end message must extend Duration
 */
export const SPAN = {
  SYNTH_ASSEMBLY: {
    name: 'Synthesis',
    start: IO.CDK_TOOLKIT_I1001,
    end: IO.CDK_TOOLKIT_I1000,
  },
  DEPLOY_STACK: {
    name: 'Deployment',
    start: IO.CDK_TOOLKIT_I5100,
    end: IO.CDK_TOOLKIT_I5001,
  },
  ROLLBACK_STACK: {
    name: 'Rollback',
    start: IO.CDK_TOOLKIT_I6100,
    end: IO.CDK_TOOLKIT_I6000,
  },
  DIFF_STACK: {
    name: 'Diff',
    start: IO.CDK_TOOLKIT_I4000,
    end: IO.CDK_TOOLKIT_I4001,
  },
  DRIFT_APP: {
    name: 'Drift',
    start: IO.CDK_TOOLKIT_I4000,
    end: IO.CDK_TOOLKIT_I4509,
  },
  DESTROY_STACK: {
    name: 'Destroy',
    start: IO.CDK_TOOLKIT_I7100,
    end: IO.CDK_TOOLKIT_I7001,
  },
  DESTROY_ACTION: {
    name: 'Destroy',
    start: IO.CDK_TOOLKIT_I7101,
    end: IO.CDK_TOOLKIT_I7000,
  },
  BOOTSTRAP_SINGLE: {
    name: 'Bootstrap',
    start: IO.CDK_TOOLKIT_I9100,
    end: IO.CDK_TOOLKIT_I9000,
  },
  BUILD_ASSET: {
    name: 'Build Asset',
    start: IO.CDK_TOOLKIT_I5210,
    end: IO.CDK_TOOLKIT_I5211,
  },
  PUBLISH_ASSET: {
    name: 'Publish Asset',
    start: IO.CDK_TOOLKIT_I5220,
    end: IO.CDK_TOOLKIT_I5221,
  },
  HOTSWAP: {
    name: 'hotswap-deployment',
    start: IO.CDK_TOOLKIT_I5400,
    end: IO.CDK_TOOLKIT_I5410,
  },
} satisfies Record<string, SpanDefinition<any, any>>;
