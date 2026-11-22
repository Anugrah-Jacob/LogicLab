/**
 * Site-wide settings. Edit this file when you deploy your own copy.
 * The build script (npm run build) also reads repoUrl for links on the learn pages.
 */
window.LOGICLAB_CONFIG = {
  siteName: 'LogicLab',
  repoUrl: 'https://github.com/Anugrah-Jacob/LogicLab',
  ads: {
    enabled: false, // keep false until you have an ad account, consent banner and updated CSP (docs/MONETIZATION.md)
    client: '', // e.g. 'ca-pub-0000000000000000'
    slots: { 'learn-top': '', 'learn-bottom': '' },
    consent: function () {
      return false; // return true only after the visitor accepted advertising cookies
    }
  }
};
