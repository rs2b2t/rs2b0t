export const browserBundles = {
    'botclient.js': 'src/bot/main.ts',
    'multibox.js': 'src/bot/multibox/main.ts',
    'ondemandworker.js': 'src/client/io/OnDemandWorker.ts',
    'navworker.js': 'src/bot/event/webwalk/NavWorker.ts'
} as const;

export const browserBundleArtifacts = Object.keys(browserBundles).flatMap(output => [output, `${output}.map`]);
