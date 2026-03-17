import Phaser from '../lib/phaser.js';
import ThreadOutGame from '../scenes/games/thread-out/ThreadOutGame.js';
import { PHYSICS_GRAVITY_Y } from '../scenes/games/thread-out/GameConfig.js';

new Phaser.Game({
  type: Phaser.AUTO,
  width: 720,
  height: 1280,
  parent: 'game-container',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  physics: {
    default: 'arcade',
    arcade: {
      gravity: { x: 0, y: PHYSICS_GRAVITY_Y },
      debug: false,
    },
  },
  scene: [ThreadOutGame],
});
