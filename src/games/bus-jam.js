import Phaser from '../lib/phaser.js';
import BusJamGame from '../scenes/games/bus-jam/BusJamGame.js';

new Phaser.Game({
  type: Phaser.AUTO,
  width: 720,
  height: 1280,
  parent: 'game-container',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: [BusJamGame],
});
