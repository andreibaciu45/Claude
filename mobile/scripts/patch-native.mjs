// Applica in modo idempotente le impostazioni native che `cap add` non crea:
// permessi microfono/riconoscimento vocale con testi in italiano, lingua, crittografia export, backup.
// Si lancia dopo `cap add` (o dopo aver rigenerato android/ios):  npm run patch:native
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const manifest = 'android/app/src/main/AndroidManifest.xml';
if (existsSync(manifest)) {
  let x = readFileSync(manifest, 'utf8');
  if (!x.includes('RECORD_AUDIO')) {
    x = x.replace('<uses-permission android:name="android.permission.INTERNET" />',
      '<uses-permission android:name="android.permission.INTERNET" />\n    <uses-permission android:name="android.permission.RECORD_AUDIO" />\n    <uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />');
  }
  if (!x.includes('android.speech.RecognitionService')) {
    // Android 11+: serve per vedere i servizi di riconoscimento vocale installati
    x = x.replace('</manifest>',
      '    <queries>\n        <intent>\n            <action android:name="android.speech.RecognitionService" />\n        </intent>\n    </queries>\n</manifest>');
  }
  // il token sta nel Keystore: niente backup automatico dei dati dell'app
  x = x.replace('android:allowBackup="true"', 'android:allowBackup="false"');
  writeFileSync(manifest, x);
  console.log('Android: manifest aggiornato');
}

const plist = 'ios/App/App/Info.plist';
if (existsSync(plist)) {
  let x = readFileSync(plist, 'utf8');
  const add = (key, xml) => { if (!x.includes(`<key>${key}</key>`)) x = x.replace(/<\/dict>\s*<\/plist>\s*$/, `\t<key>${key}</key>\n\t${xml}\n</dict>\n</plist>\n`); };
  add('NSMicrophoneUsageDescription', '<string>Il microfono serve per dettare a voce righe, quantità e comandi dei preventivi e delle fatture. L’audio non viene registrato né conservato.</string>');
  add('NSSpeechRecognitionUsageDescription', '<string>Il riconoscimento vocale trasforma la tua voce in testo per compilare i documenti. L’audio può essere elaborato da Apple per il riconoscimento.</string>');
  add('ITSAppUsesNonExemptEncryption', '<false/>');
  x = x.replace(/(<key>CFBundleDevelopmentRegion<\/key>\s*<string>)en(<\/string>)/, '$1it$2');
  writeFileSync(plist, x);
  console.log('iOS: Info.plist aggiornato');
}
