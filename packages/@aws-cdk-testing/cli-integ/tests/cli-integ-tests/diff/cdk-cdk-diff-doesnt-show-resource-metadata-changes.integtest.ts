import { integTest, withDefaultFixture } from '../../../lib';

integTest(
  'cdk diff doesnt show resource metadata changes',
  withDefaultFixture(async (fixture) => {
    // GIVEN - small initial stack with default resource metadata
    await fixture.cdkDeploy('metadata');

    // WHEN - changing resource metadata value
    const diff = await fixture.cdk(['diff', fixture.fullStackName('metadata')], {
      verbose: true,
      modEnv: {
        INTEG_METADATA_VALUE: 'custom',
      },
    });

    // Assert no visible changes, but hint indicates hidden metadata changes
    expect(diff).toContain('There were no differences');
    expect(diff).toContain('CDK metadata changes were hidden, run cdk diff --strict to show');
  }),
);

