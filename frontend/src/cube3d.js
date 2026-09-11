/* Rubik's Cube 3D visualization using Three.js */

const COLORS = {
  U: 0xffffff,  // white
  D: 0xffd500,  // yellow
  F: 0x009b48,  // green
  B: 0x0046ad,  // blue
  L: 0xff5900,  // orange
  R: 0xb71234,  // red
  interior: 0x1a1a1a
};

const FACE_CHARS = { U: 'U', D: 'D', F: 'F', B: 'B', L: 'L', R: 'R' };

// Facelet index → { face, cubiePos, stickerIndex }
// Facelet string layout (54 chars, 9 per face):
//         U0 U1 U2
//         U3 U4 U5
//         U6 U7 U8
// L0 L1 L2 F0 F1 F2 R0 R1 R2 B0 B1 B2
// L3 L4 L5 F3 F4 F5 R3 R4 R5 B3 B4 B5
// L6 L7 L8 F6 F7 F8 R6 R7 R8 B6 B7 B8
//         D0 D1 D2
//         D3 D4 D5
//         D6 D7 D8
const FACELET_MAP = {
  U: [
    { pos: [-1, 1, 1], row: 0, col: 0 }, { pos: [0, 1, 1], row: 0, col: 1 }, { pos: [1, 1, 1], row: 0, col: 2 },
    { pos: [-1, 1, 0], row: 1, col: 0 }, { pos: [0, 1, 0], row: 1, col: 1 }, { pos: [1, 1, 0], row: 1, col: 2 },
    { pos: [-1, 1, -1], row: 2, col: 0 }, { pos: [0, 1, -1], row: 2, col: 1 }, { pos: [1, 1, -1], row: 2, col: 2 }
  ],
  R: [
    { pos: [1, 1, 1], row: 0, col: 0 }, { pos: [1, 1, 0], row: 0, col: 1 }, { pos: [1, 1, -1], row: 0, col: 2 },
    { pos: [1, 0, 1], row: 1, col: 0 }, { pos: [1, 0, 0], row: 1, col: 1 }, { pos: [1, 0, -1], row: 1, col: 2 },
    { pos: [1, -1, 1], row: 2, col: 0 }, { pos: [1, -1, 0], row: 2, col: 1 }, { pos: [1, -1, -1], row: 2, col: 2 }
  ],
  F: [
    { pos: [-1, 1, 1], row: 0, col: 0 }, { pos: [0, 1, 1], row: 0, col: 1 }, { pos: [1, 1, 1], row: 0, col: 2 },
    { pos: [-1, 0, 1], row: 1, col: 0 }, { pos: [0, 0, 1], row: 1, col: 1 }, { pos: [1, 0, 1], row: 1, col: 2 },
    { pos: [-1, -1, 1], row: 2, col: 0 }, { pos: [0, -1, 1], row: 2, col: 1 }, { pos: [1, -1, 1], row: 2, col: 2 }
  ],
  D: [
    { pos: [-1, -1, 1], row: 0, col: 0 }, { pos: [0, -1, 1], row: 0, col: 1 }, { pos: [1, -1, 1], row: 0, col: 2 },
    { pos: [-1, -1, 0], row: 1, col: 0 }, { pos: [0, -1, 0], row: 1, col: 1 }, { pos: [1, -1, 0], row: 1, col: 2 },
    { pos: [-1, -1, -1], row: 2, col: 0 }, { pos: [0, -1, -1], row: 2, col: 1 }, { pos: [1, -1, -1], row: 2, col: 2 }
  ],
  L: [
    { pos: [-1, 1, -1], row: 0, col: 0 }, { pos: [-1, 1, 0], row: 0, col: 1 }, { pos: [-1, 1, 1], row: 0, col: 2 },
    { pos: [-1, 0, -1], row: 1, col: 0 }, { pos: [-1, 0, 0], row: 1, col: 1 }, { pos: [-1, 0, 1], row: 1, col: 2 },
    { pos: [-1, -1, -1], row: 2, col: 0 }, { pos: [-1, -1, 0], row: 2, col: 1 }, { pos: [-1, -1, 1], row: 2, col: 2 }
  ],
  B: [
    { pos: [1, 1, -1], row: 0, col: 0 }, { pos: [0, 1, -1], row: 0, col: 1 }, { pos: [-1, 1, -1], row: 0, col: 2 },
    { pos: [1, 0, -1], row: 1, col: 0 }, { pos: [0, 0, -1], row: 1, col: 1 }, { pos: [-1, 0, -1], row: 1, col: 2 },
    { pos: [1, -1, -1], row: 2, col: 0 }, { pos: [0, -1, -1], row: 2, col: 1 }, { pos: [-1, -1, -1], row: 2, col: 2 }
  ]
};

export class Cube3D {
  constructor(container) {
    this.container = container;
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.controls = null;
    this.cubies = [];
    this.isPlaying = false;
    this.currentMoveIndex = 0;
    this.solution = [];
    this.animationSpeed = 300;
    this.scrambleMoves = [];

    this.init();
  }

  init() {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xf8f7f4);

    this.camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
    this.camera.position.set(5, 5, 5);
    this.camera.lookAt(0, 0, 0);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.container.appendChild(this.renderer.domElement);

    this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.minDistance = 4;
    this.controls.maxDistance = 15;

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(ambientLight);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(5, 10, 7);
    this.scene.add(directionalLight);

    this.createCube();

    window.addEventListener('resize', () => this.onResize());
    this.animate();
  }

  createCube() {
    const geometry = new THREE.BoxGeometry(0.95, 0.95, 0.95);
    const stickerGeometry = new THREE.PlaneGeometry(0.85, 0.85);
    const stickerOffset = 0.48;

    for (let x = -1; x <= 1; x++) {
      for (let y = -1; y <= 1; y++) {
        for (let z = -1; z <= 1; z++) {
          const materials = [
            new THREE.MeshLambertMaterial({ color: COLORS.interior }),
            new THREE.MeshLambertMaterial({ color: COLORS.interior }),
            new THREE.MeshLambertMaterial({ color: COLORS.interior }),
            new THREE.MeshLambertMaterial({ color: COLORS.interior }),
            new THREE.MeshLambertMaterial({ color: COLORS.interior }),
            new THREE.MeshLambertMaterial({ color: COLORS.interior })
          ];

          const cubie = new THREE.Mesh(geometry, materials);
          cubie.position.set(x, y, z);
          cubie.userData = { gridPos: { x, y, z } };

          // Create 6 stickers as children
          const stickerConfigs = [
            { pos: [0, stickerOffset, 0], rot: [Math.PI / 2, 0, 0], face: 'U' },
            { pos: [0, -stickerOffset, 0], rot: [-Math.PI / 2, 0, 0], face: 'D' },
            { pos: [0, 0, stickerOffset], rot: [0, 0, 0], face: 'F' },
            { pos: [0, 0, -stickerOffset], rot: [0, Math.PI, 0], face: 'B' },
            { pos: [stickerOffset, 0, 0], rot: [0, Math.PI / 2, 0], face: 'R' },
            { pos: [-stickerOffset, 0, 0], rot: [0, -Math.PI / 2, 0], face: 'L' }
          ];

          stickerConfigs.forEach(config => {
            const sticker = new THREE.Mesh(stickerGeometry, new THREE.MeshLambertMaterial({ color: COLORS.interior }));
            sticker.position.set(...config.pos);
            sticker.rotation.set(...config.rot);
            sticker.userData.face = config.face;
            cubie.add(sticker);
          });

          this.scene.add(cubie);
          this.cubies.push(cubie);
        }
      }
    }

    // Initialize solved state colors
    this.updateStickers('UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB');
  }

  getCubieAt(x, y, z) {
    return this.cubies.find(c =>
      Math.round(c.position.x) === x &&
      Math.round(c.position.y) === y &&
      Math.round(c.position.z) === z
    );
  }

  updateStickers(faceletString) {
    if (!faceletString || faceletString.length !== 54) return;

    const faces = ['U', 'R', 'F', 'D', 'L', 'B'];
    let faceletIdx = 0;

    for (const face of faces) {
      const faceMap = FACELET_MAP[face];
      for (let i = 0; i < 9; i++) {
        const { pos } = faceMap[i];
        const color = faceletString[faceletIdx];
        const cubie = this.getCubieAt(pos[0], pos[1], pos[2]);

        if (cubie) {
          const sticker = cubie.children.find(s => s.userData.face === face);
          if (sticker) {
            sticker.material.color.setHex(COLORS[color] || COLORS.interior);
          }
        }
        faceletIdx++;
      }
    }
  }

  applyMove(move, animate = true) {
    const moveMap = {
      'U': { axis: 'y', layer: 1, angle: -Math.PI / 2 },
      "U'": { axis: 'y', layer: 1, angle: Math.PI / 2 },
      'D': { axis: 'y', layer: -1, angle: Math.PI / 2 },
      "D'": { axis: 'y', layer: -1, angle: -Math.PI / 2 },
      'R': { axis: 'x', layer: 1, angle: -Math.PI / 2 },
      "R'": { axis: 'x', layer: 1, angle: Math.PI / 2 },
      'L': { axis: 'x', layer: -1, angle: Math.PI / 2 },
      "L'": { axis: 'x', layer: -1, angle: -Math.PI / 2 },
      'F': { axis: 'z', layer: 1, angle: -Math.PI / 2 },
      "F'": { axis: 'z', layer: 1, angle: Math.PI / 2 },
      'B': { axis: 'z', layer: -1, angle: Math.PI / 2 },
      "B'": { axis: 'z', layer: -1, angle: -Math.PI / 2 }
    };

    const moveData = moveMap[move];
    if (!moveData) return Promise.resolve();

    const cubiesInLayer = this.cubies.filter(c => {
      const pos = c.userData.gridPos;
      return pos[moveData.axis] === moveData.layer;
    });

    if (animate) {
      return this.animateMove(cubiesInLayer, moveData.axis, moveData.angle);
    } else {
      cubiesInLayer.forEach(c => {
        c.rotateOnWorldAxis(new THREE.Vector3(
          moveData.axis === 'x' ? 1 : 0,
          moveData.axis === 'y' ? 1 : 0,
          moveData.axis === 'z' ? 1 : 0
        ), moveData.angle);
        this.updateGridPos(c, moveData.axis, moveData.angle);
      });
      return Promise.resolve();
    }
  }

  animateMove(cubies, axis, angle) {
    return new Promise(resolve => {
      const duration = this.animationSpeed;
      const startTime = Date.now();
      const totalAngle = angle;
      let currentAngle = 0;

      const animate = () => {
        const elapsed = Date.now() - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3);

        const deltaAngle = (eased * totalAngle) - currentAngle;
        currentAngle = eased * totalAngle;

        cubies.forEach(c => {
          c.rotateOnWorldAxis(new THREE.Vector3(
            axis === 'x' ? 1 : 0,
            axis === 'y' ? 1 : 0,
            axis === 'z' ? 1 : 0
          ), deltaAngle);
        });

        if (progress < 1) {
          requestAnimationFrame(animate);
        } else {
          cubies.forEach(c => {
            this.updateGridPos(c, axis, totalAngle);
          });
          resolve();
        }
      };

      animate();
    });
  }

  updateGridPos(cubie, axis, angle) {
    const pos = cubie.userData.gridPos;
    const threshold = 0.5;

    if (axis === 'x' && Math.abs(angle) > threshold) {
      const newY = pos.z * (angle > 0 ? -1 : 1);
      const newZ = pos.y * (angle > 0 ? 1 : -1);
      pos.y = Math.round(newY);
      pos.z = Math.round(newZ);
    } else if (axis === 'y' && Math.abs(angle) > threshold) {
      const newX = pos.z * (angle > 0 ? 1 : -1);
      const newZ = pos.x * (angle > 0 ? -1 : 1);
      pos.x = Math.round(newX);
      pos.z = Math.round(newZ);
    } else if (axis === 'z' && Math.abs(angle) > threshold) {
      const newX = pos.y * (angle > 0 ? -1 : 1);
      const newY = pos.x * (angle > 0 ? 1 : -1);
      pos.x = Math.round(newX);
      pos.y = Math.round(newY);
    }
  }

  async playSolution(moves) {
    this.solution = moves;
    this.currentMoveIndex = 0;
    this.isPlaying = true;

    while (this.currentMoveIndex < this.solution.length && this.isPlaying) {
      const move = this.solution[this.currentMoveIndex];
      await this.applyMove(move, true);
      this.currentMoveIndex++;
    }
  }

  pause() {
    this.isPlaying = false;
  }

  next() {
    if (this.currentMoveIndex < this.solution.length) {
      this.applyMove(this.solution[this.currentMoveIndex], true);
      this.currentMoveIndex++;
    }
  }

  prev() {
    if (this.currentMoveIndex > 0) {
      const move = this.solution[this.currentMoveIndex - 1];
      const inverse = move.includes("'") ? move.replace("'", "") : move + "'";
      this.applyMove(inverse, true);
      this.currentMoveIndex--;
    }
  }

  setSpeed(ms) {
    this.animationSpeed = ms;
  }

  async applyMoves(moves, animate = true) {
    for (const move of moves) {
      await this.applyMove(move, animate);
    }
  }

  reset() {
    this.solution = [];
    this.currentMoveIndex = 0;
    this.isPlaying = false;
    this.scrambleMoves = [];

    // Reset all cubies to solved positions
    this.cubies.forEach(c => {
      c.rotation.set(0, 0, 0);
      // Reset grid positions
      const x = Math.round(c.position.x);
      const y = Math.round(c.position.y);
      const z = Math.round(c.position.z);
      c.userData.gridPos = { x, y, z };
    });

    // Reset sticker colors to solved state
    this.updateStickers('UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB');
  }

  onResize() {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  animate() {
    requestAnimationFrame(() => this.animate());
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}
