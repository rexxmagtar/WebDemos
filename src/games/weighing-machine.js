import Phaser from '../lib/phaser.js';
import WeighingMachineGame from '../scenes/games/weighing-machine/WeighingMachineGame.js';

new Phaser.Game({
  type: Phaser.AUTO,
  width: 720,
  height: 1280,
  parent: 'game-container',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: [WeighingMachineGame],
});
