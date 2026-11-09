const pkg=require('./package.json');
const path=require('node:path');
const {signingConfig}=require('./scripts/desktop-signing/config.cjs');
const signing=signingConfig();
if(!process.env.CBIM_DESKTOP_OUTPUT)throw Error('请通过 pnpm make:desktop 构建独立签名候选');
const version=process.env.CBIM_DESKTOP_VERSION||pkg.version;
if(!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version))throw Error('Invalid desktop version');
module.exports={
  appId:'com.cbim.assistant.desktop',productName:'CBIM Assistant',
  extraMetadata:{version},
  directories:{output:process.env.CBIM_DESKTOP_OUTPUT},
  forceCodeSigning:true,
  artifactName:'CBIM-Setup-${version}-${arch}.${ext}',
  win:{target:[{target:'nsis',arch:['x64']}],executableName:'CBIM Desktop',signAndEditExecutable:true,
    signtoolOptions:{publisherName:[signing.publisherName],signingHashAlgorithms:['sha256'],sign:path.resolve('scripts/desktop-signing/electron-builder-sign.cjs')}},
  nsis:{oneClick:false,perMachine:false,allowElevation:false,packElevateHelper:false,allowToChangeInstallationDirectory:true,deleteAppDataOnUninstall:false,runAfterFinish:false,createDesktopShortcut:true,shortcutName:'CBIM Assistant',include:'packaging/updater/installer.nsh'},
  publish:[{provider:'generic',url:`https://github.com/nan023062/cbim/releases/download/desktop-v${version}/`}],
};
