import Phaser from '../lib/phaser.js';
import GardenFlowGame from '../scenes/games/garden-flow/GardenFlowGame.js';

new Phaser.Game({
  type: Phaser.AUTO,
  width: 720,
  height: 1280,
  parent: 'game-container',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: [GardenFlowGame],
});
