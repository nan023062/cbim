const pkg=require('./package.json');
const version=process.env.CBIM_DESKTOP_VERSION||pkg.version;
if(!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version))throw Error('Invalid desktop version');
module.exports={
  appId:'com.cbim.assistant.desktop',productName:'CBIM Assistant',
  extraMetadata:{version},
  directories:{output:'build/desktop-release/'+version},
  artifactName:'CBIM-Setup-${version}-${arch}.${ext}',
  win:{target:[{target:'nsis',arch:['x64']}],executableName:'CBIM Desktop',signAndEditExecutable:false},
  nsis:{oneClick:false,perMachine:false,allowElevation:false,allowToChangeInstallationDirectory:true,deleteAppDataOnUninstall:false,runAfterFinish:false,createDesktopShortcut:true,shortcutName:'CBIM Assistant',include:'packaging/updater/installer.nsh'},
  publish:[{provider:'generic',url:`https://github.com/nan023062/cbim/releases/download/desktop-v${version}/`}],
};
