import type * as cxapi from '@aws-cdk/cx-api';
import * as chalk from 'chalk';
import { DiffFormatter } from '../../../lib/api/diff/diff-formatter';

describe('formatStackDiff', () => {
  let mockNewTemplate: cxapi.CloudFormationStackArtifact;

  beforeEach(() => {
    mockNewTemplate = {
      template: {
        Resources: {
          Func: {
            Type: 'AWS::Lambda::Function',
            Properties: {
              Code: {
                S3Bucket: 'XXXXXXXXXXX',
                S3Key: 'some-key',
              },
              Handler: 'index.handler',
              Runtime: 'nodejs14.x',
            },
          },
        },
      },
      templateFile: 'template.json',
      stackName: 'test-stack',
      findMetadataByType: () => [],
    } as any;
  });

  test('returns no differences when templates are identical', () => {
    // WHEN
    const formatter = new DiffFormatter({
      templateInfo: {
        oldTemplate: mockNewTemplate.template,
        newTemplate: mockNewTemplate,
      },
    });
    const result = formatter.formatStackDiff();

    // THEN
    expect(result.numStacksWithChanges).toBe(0);
    expect(result.formattedDiff).toBeDefined();
    expect(result.permissionChangeType).toBe('none');
    const sanitizedDiff = result.formattedDiff!.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '').trim();
    expect(sanitizedDiff).toBe(
      'Stack test-stack\n' +
      'There were no differences',
    );
  });

  test('formats differences when changes exist', () => {
    // WHEN
    const formatter = new DiffFormatter({
      templateInfo: {
        oldTemplate: {},
        newTemplate: mockNewTemplate,
      },
    });
    const result = formatter.formatStackDiff();

    // THEN
    expect(result.numStacksWithChanges).toBe(1);
    expect(result.formattedDiff).toBeDefined();
    expect(result.permissionChangeType).toBe('none');
    const sanitizedDiff = result.formattedDiff!.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '').trim();
    expect(sanitizedDiff).toBe(
      'Stack test-stack\n' +
      'Resources\n' +
      '[+] AWS::Lambda::Function Func',
    );
  });

  test('formats differences with isImport', () => {
    // WHEN
    const formatter = new DiffFormatter({
      templateInfo: {
        oldTemplate: {},
        newTemplate: mockNewTemplate,
        isImport: true,
      },
    });
    const result = formatter.formatStackDiff();

    // THEN
    expect(result.numStacksWithChanges).toBe(1);
    expect(result.formattedDiff).toBeDefined();
    expect(result.permissionChangeType).toBe('none');
    const sanitizedDiff = result.formattedDiff!.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '').trim();
    expect(sanitizedDiff).toBe(
      'Stack test-stack\n' +
      'Parameters and rules created during migration do not affect resource configuration.\n' +
      'Resources\n' +
      '[←] AWS::Lambda::Function Func import',
    );
  });

  test('formats differences showing resource moves', () => {
    // WHEN
    const formatter = new DiffFormatter({
      templateInfo: {
        oldTemplate: {},
        newTemplate: mockNewTemplate,
        mappings: {
          'test-stack.OldName': 'test-stack.Func',
        },
      },
    });
    const result = formatter.formatStackDiff();

    // THEN
    expect(result.formattedDiff).toBeDefined();
    expect(result.permissionChangeType).toBe('none');
    const sanitizedDiff = result.formattedDiff!.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '').trim();
    expect(sanitizedDiff).toBe(
      'Stack test-stack\n' +
      'Resources\n' +
      '[+] AWS::Lambda::Function Func (OR move from test-stack.OldName via refactoring)',
    );
  });

  test('handles nested stack templates', () => {
    // GIVEN
    const nestedStacks = {
      NestedStack1: {
        deployedTemplate: {},
        generatedTemplate: {},
        physicalName: 'nested-stack-1',
        nestedStackTemplates: {
          NestedStack2: {
            deployedTemplate: {},
            generatedTemplate: {},
            physicalName: 'nested-stack-2',
            nestedStackTemplates: {},
          },
        },
      },
    };

    // WHEN
    const formatter = new DiffFormatter({
      templateInfo: {
        oldTemplate: {},
        newTemplate: mockNewTemplate,
        nestedStacks,
      },
    });
    const result = formatter.formatStackDiff();

    // THEN
    expect(result.numStacksWithChanges).toBe(3);
    expect(result.permissionChangeType).toBe('none');
    expect(result.formattedDiff).toContain(`Stack ${chalk.bold('test-stack')}`);
    expect(result.formattedDiff).toContain(`Stack ${chalk.bold('nested-stack-1')}`);
    expect(result.formattedDiff).toContain(`Stack ${chalk.bold('nested-stack-2')}`);
  });

  test('returns broadening permission change type when IAM changes broaden permissions', () => {
    // GIVEN
    const templateWithIAM: cxapi.CloudFormationStackArtifact = {
      template: {
        Resources: {
          Role: {
            Type: 'AWS::IAM::Role',
            Properties: {
              AssumeRolePolicyDocument: {
                Version: '2012-10-17',
                Statement: [{
                  Effect: 'Allow',
                  Principal: {
                    Service: 'lambda.amazonaws.com',
                  },
                  Action: 'sts:AssumeRole',
                }],
              },
            },
          },
        },
      },
      templateFile: 'template.json',
      stackName: 'test-stack',
      findMetadataByType: () => [],
    } as any;

    // WHEN
    const formatter = new DiffFormatter({
      templateInfo: {
        oldTemplate: {},
        newTemplate: templateWithIAM,
      },
    });
    const result = formatter.formatStackDiff();

    // THEN
    expect(result.numStacksWithChanges).toBe(1);
    expect(result.permissionChangeType).toBe('broadening');
    expect(result.formattedDiff).toBeDefined();
    const sanitizedDiff = result.formattedDiff!.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '').trim();
    expect(sanitizedDiff).toContain('Stack test-stack');
    expect(sanitizedDiff).toContain('[+] AWS::IAM::Role Role');
  });

  test('returns non-broadening permission change type when IAM changes but no broadening', () => {
    // GIVEN
    const oldTemplate = {
      Resources: {
        Role: {
          Type: 'AWS::IAM::Role',
          Properties: {
            AssumeRolePolicyDocument: {
              Version: '2012-10-17',
              Statement: [{
                Effect: 'Allow',
                Principal: {
                  Service: 'lambda.amazonaws.com',
                },
                Action: 'sts:AssumeRole',
              }],
            },
            ManagedPolicyArns: [
              'arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole',
              'arn:aws:iam::aws:policy/AmazonS3FullAccess',
            ],
          },
        },
      },
    };

    const newTemplate: cxapi.CloudFormationStackArtifact = {
      template: {
        Resources: {
          Role: {
            Type: 'AWS::IAM::Role',
            Properties: {
              AssumeRolePolicyDocument: {
                Version: '2012-10-17',
                Statement: [{
                  Effect: 'Allow',
                  Principal: {
                    Service: 'lambda.amazonaws.com',
                  },
                  Action: 'sts:AssumeRole',
                }],
              },
              ManagedPolicyArns: [
                'arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole',
              ],
            },
          },
        },
      },
      templateFile: 'template.json',
      stackName: 'test-stack',
      findMetadataByType: () => [],
    } as any;

    // WHEN - removing a managed policy (narrowing permissions)
    const formatter = new DiffFormatter({
      templateInfo: {
        oldTemplate,
        newTemplate,
      },
    });
    const result = formatter.formatStackDiff();

    // THEN
    expect(result.numStacksWithChanges).toBe(1);
    expect(result.permissionChangeType).toBe('non-broadening');
    expect(result.formattedDiff).toBeDefined();
  });

  test('uses changeSet parameter when provided', () => {
    // GIVEN
    const mockChangeSet = {
      ChangeSetName: 'test-changeset',
      Changes: [
        {
          Type: 'Resource',
          ResourceChange: {
            Action: 'Add',
            LogicalResourceId: 'Func',
            ResourceType: 'AWS::Lambda::Function',
          },
        },
      ],
      Status: 'CREATE_COMPLETE',
      $metadata: {},
    };

    // WHEN
    const formatter = new DiffFormatter({
      templateInfo: {
        oldTemplate: {},
        newTemplate: mockNewTemplate,
        changeSet: mockChangeSet,
      },
    });
    const result = formatter.formatStackDiff();

    // THEN
    expect(result.numStacksWithChanges).toBe(1);
    expect(result.permissionChangeType).toBe('none');
    expect(result.formattedDiff).toBeDefined();
    // The changeSet should be used internally by the fullDiff function
    // We can't easily verify this directly, but the diff should still work correctly
    const sanitizedDiff = result.formattedDiff!.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '').trim();
    expect(sanitizedDiff).toBe(
      'Stack test-stack\n' +
      'Resources\n' +
      '[+] AWS::Lambda::Function Func',
    );
  });

  test('handles permission change type with both changeSet and IAM resources', () => {
    // GIVEN
    const templateWithIAM: cxapi.CloudFormationStackArtifact = {
      template: {
        Resources: {
          Role: {
            Type: 'AWS::IAM::Role',
            Properties: {
              AssumeRolePolicyDocument: {
                Version: '2012-10-17',
                Statement: [{
                  Effect: 'Allow',
                  Principal: { Service: 'lambda.amazonaws.com' },
                  Action: 'sts:AssumeRole',
                }],
              },
            },
          },
        },
      },
      templateFile: 'template.json',
      stackName: 'test-stack',
      findMetadataByType: () => [],
    } as any;

    const mockChangeSet = {
      ChangeSetName: 'test-changeset',
      Changes: [
        {
          Type: 'Resource',
          ResourceChange: {
            Action: 'Add',
            LogicalResourceId: 'Role',
            ResourceType: 'AWS::IAM::Role',
          },
        },
      ],
      Status: 'CREATE_COMPLETE',
      $metadata: {},
    };

    // WHEN
    const formatter = new DiffFormatter({
      templateInfo: {
        oldTemplate: {},
        newTemplate: templateWithIAM,
        changeSet: mockChangeSet,
      },
    });
    const result = formatter.formatStackDiff();

    // THEN
    expect(result.numStacksWithChanges).toBe(1);
    expect(result.permissionChangeType).toBe('broadening');
    expect(result.formattedDiff).toBeDefined();
  });
});

describe('formatSecurityDiff', () => {
  let mockNewTemplate: cxapi.CloudFormationStackArtifact;

  beforeEach(() => {
    mockNewTemplate = {
      template: {
        Resources: {
          Role: {
            Type: 'AWS::IAM::Role',
            Properties: {
              AssumeRolePolicyDocument: {
                Version: '2012-10-17',
                Statement: [{
                  Effect: 'Allow',
                  Principal: {
                    Service: 'lambda.amazonaws.com',
                  },
                  Action: 'sts:AssumeRole',
                }],
              },
              ManagedPolicyArns: [
                'arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole',
              ],
            },
          },
        },
      },
      templateFile: 'template.json',
      stackName: 'test-stack',
      findMetadataByType: () => [],
    } as any;
  });

  test('returns information on security changes for the IoHost to interpret', () => {
    // WHEN
    const formatter = new DiffFormatter({
      templateInfo: {
        oldTemplate: mockNewTemplate.template,
        newTemplate: mockNewTemplate,
      },
    });
    const result = formatter.formatSecurityDiff();

    // THEN
    expect(result.permissionChangeType).toEqual('none');
  });

  test('returns formatted diff for broadening security changes', () => {
    // WHEN
    const formatter = new DiffFormatter({
      templateInfo: {
        oldTemplate: {},
        newTemplate: mockNewTemplate,
      },
    });
    const result = formatter.formatSecurityDiff();

    // THEN
    expect(result.permissionChangeType).toEqual('broadening');
    const sanitizedDiff = result.formattedDiff!.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '').trim();
    expect(sanitizedDiff).toBe(
      'Stack test-stack\n' +
      'IAM Statement Changes\n' +
      '┌───┬─────────────┬────────┬────────────────┬──────────────────────────────┬───────────┐\n' +
      '│   │ Resource    │ Effect │ Action         │ Principal                    │ Condition │\n' +
      '├───┼─────────────┼────────┼────────────────┼──────────────────────────────┼───────────┤\n' +
      '│ + │ ${Role.Arn} │ Allow  │ sts:AssumeRole │ Service:lambda.amazonaws.com │           │\n' +
      '└───┴─────────────┴────────┴────────────────┴──────────────────────────────┴───────────┘\n' +
      'IAM Policy Changes\n' +
      '┌───┬──────────┬──────────────────────────────────────────────────────────────────┐\n' +
      '│   │ Resource │ Managed Policy ARN                                               │\n' +
      '├───┼──────────┼──────────────────────────────────────────────────────────────────┤\n' +
      '│ + │ ${Role}  │ arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole │\n' +
      '└───┴──────────┴──────────────────────────────────────────────────────────────────┘\n' +
      '(NOTE: There may be security-related changes not in this list. See https://github.com/aws/aws-cdk/issues/1299)',
    );
  });
});
