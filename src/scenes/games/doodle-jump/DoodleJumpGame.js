import Phaser from '../../../lib/phaser.js';

const PLATFORM_WIDTH = 100;
const PLATFORM_HEIGHT = 20;
const PLAYER_WIDTH = 40;
const PLAYER_HEIGHT = 50;
const JUMP_VELOCITY = -550;
const MOVE_SPEED = 280;

export default class DoodleJumpGame extends Phaser.Scene {
  constructor() {
    super({ key: 'DoodleJumpGame' });
  }

  init() {
    this.score = 0;
    this.highestY = 0;
    this.gameOver = false;
  }

  preload() {
    // Generate player texture
    const playerGfx = this.make.graphics({ x: 0, y: 0, add: false });
    playerGfx.fillStyle(0xff6b6b, 1);
    playerGfx.fillRoundedRect(0, 0, PLAYER_WIDTH, PLAYER_HEIGHT, 8);
    playerGfx.generateTexture('player', PLAYER_WIDTH, PLAYER_HEIGHT);

    // Generate platform texture
    const platformGfx = this.make.graphics({ x: 0, y: 0, add: false });
    platformGfx.fillStyle(0x2ecc71, 1);
    platformGfx.fillRoundedRect(0, 0, PLATFORM_WIDTH, PLATFORM_HEIGHT, 4);
    platformGfx.generateTexture('platform', PLATFORM_WIDTH, PLATFORM_HEIGHT);
  }

  create() {
    const { width, height } = this.cameras.main;
    this.worldHeight = height;
    this.worldWidth = width;

    this.physics.world.setBounds(0, -100000, width * 2, 150000);

    // Fixed UI elements (don't scroll with camera)
    const backBtn = this.add.text(60, 30, 'Back', {
      fontSize: '20px',
      color: '#ffffff',
      fontFamily: 'sans-serif',
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    backBtn.setScrollFactor(0);
    backBtn.on('pointerdown', () => { window.location.href = 'index.html'; });

    this.scoreText = this.add.text(width / 2, 30, '0', {
      fontSize: '28px',
      color: '#ffffff',
      fontFamily: 'sans-serif',
    }).setOrigin(0.5);
    this.scoreText.setScrollFactor(0);

    // Player - start near bottom
    this.player = this.physics.add.image(width / 2, height - 150, 'player');
    this.player.setCollideWorldBounds(false);
    this.player.body.setSize(PLAYER_WIDTH - 10, PLAYER_HEIGHT - 5);
    this.player.body.setOffset(5, 2);

    // Platforms group
    this.platforms = this.physics.add.staticGroup();

    // Spawn initial platforms - ground level and above
    this.highestPlatformY = height - 100;
    for (let i = 0; i < 8; i++) {
      this.spawnPlatformRow(this.highestPlatformY - i * 120);
    }
    this.highestPlatformY = height - 100 - 7 * 120;

    // Collision: bounce player on platform land
    this.physics.add.collider(this.player, this.platforms, (player, platform) => {
      if (player.body.touching.down && player.body.velocity.y >= 0) {
        player.setVelocityY(JUMP_VELOCITY);
      }
    });

    // Input
    this.cursors = this.input.keyboard.createCursorKeys();
    this.keys = this.input.keyboard.addKeys({ a: 'A', d: 'D' });

    // Initial camera position
    this.cameras.main.setScroll(0, Math.max(0, this.player.y - height * 0.65));
  }

  spawnPlatformRow(y) {
    const { width } = this.cameras.main;
    const count = Phaser.Math.Between(3, 5);
    const gap = width / (count + 1);
    for (let i = 0; i < count; i++) {
      const x = gap * (i + 1) + Phaser.Math.Between(-30, 30);
      this.platforms.create(x, y, 'platform');
    }
  }

  recyclePlatforms() {
    const cam = this.cameras.main;
    const scrollY = cam.scrollY;
    const bottomEdge = scrollY + this.worldHeight + 80;

    this.platforms.getChildren().forEach((platform) => {
      if (platform.y > bottomEdge) {
        platform.destroy();
      }
    });
  }

  update() {
    if (this.gameOver) return;

    const { width, height } = this.cameras.main;
    const cam = this.cameras.main;

    // Horizontal movement
    let moveX = 0;
    if (this.cursors.left.isDown || this.keys.a.isDown) moveX = -1;
    if (this.cursors.right.isDown || this.keys.d.isDown) moveX = 1;
    this.player.setVelocityX(moveX * MOVE_SPEED);

    // Horizontal wrap (Doodle Jump style)
    if (this.player.x < -30) this.player.x = width + 30;
    if (this.player.x > width + 30) this.player.x = -30;

    // Camera follow (only scroll up when player ascends)
    const targetScrollY = this.player.y - height * 0.6;
    if (targetScrollY < cam.scrollY) {
      cam.setScroll(0, targetScrollY);
    }

    // Spawn new platforms when player reaches upper third
    if (this.player.y < this.highestPlatformY - height * 0.4) {
      this.highestPlatformY -= 150;
      this.spawnPlatformRow(this.highestPlatformY);
    }

    this.recyclePlatforms();

    // Score = height climbed (higher score = higher on screen = lower Y)
    const newScore = Math.max(0, Math.floor((1200 - this.player.y + cam.scrollY) / 2));
    if (newScore > this.score) {
      this.score = newScore;
      this.scoreText.setText(this.score);
    }

    // Game over - fell below visible area
    if (this.player.y > cam.scrollY + height + 60) {
      this.gameOver = true;
      this.physics.pause();

      this.add.text(width / 2, height / 2 - 40, 'Game Over', {
        fontSize: '48px',
        color: '#ff6b6b',
        fontFamily: 'sans-serif',
      }).setOrigin(0.5).setScrollFactor(0);

      this.add.text(width / 2, height / 2 + 20, `Score: ${this.score}`, {
        fontSize: '28px',
        color: '#ffffff',
        fontFamily: 'sans-serif',
      }).setOrigin(0.5).setScrollFactor(0);

      const restartBtn = this.add.text(width / 2, height / 2 + 80, 'Play Again', {
        fontSize: '24px',
        color: '#4ecdc4',
        fontFamily: 'sans-serif',
      }).setOrigin(0.5).setInteractive({ useHandCursor: true });
      restartBtn.setScrollFactor(0);
      restartBtn.on('pointerdown', () => this.scene.restart());
    }
  }
}
