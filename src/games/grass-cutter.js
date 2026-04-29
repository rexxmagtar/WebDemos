import Phaser from '../lib/phaser.js';
import GrassCutterGame from '../scenes/games/grass-cutter/GrassCutterGame.js';

new Phaser.Game({
  type: Phaser.AUTO,
  width: 720,
  height: 1280,
  parent: 'game-container',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: [GrassCutterGame],
});
