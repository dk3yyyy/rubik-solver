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

// Facelet index → { face, cubiePos }
const FACELET_MAP = {
  U: [
    { pos: [-1, 1, 1] }, { pos: [0, 1, 1] }, { pos: [1, 1, 1] },
    { pos: [-1, 1, 0] }, { pos: [0, 1, 0] }, { pos: [1, 1, 0] },
    { pos: [-1, 1, -1] }, { pos: [0, 1, -1] }, { pos: [1, 1, -1] }
  ],
  R: [
    { pos: [1, 1, 1] }, { pos: [1, 1, 0] }, { pos: [1, 1, -1] },
    { pos: [1, 0, 1] }, { pos: [1, 0, 0] }, { pos: [1, 0, -1] },
    { pos: [1, -1, 1] }, { pos: [1, -1, 0] }, { pos: [1, -1, -1] }
  ],
  F: [
    { pos: [-1, 1, 1] }, { pos: [0, 1, 1] }, { pos: [1, 1, 1] },
    { pos: [-1, 0, 1] }, { pos: [0, 0, 1] }, { pos: [1, 0, 1] },
    { pos: [-1, -1, 1] }, { pos: [0, -1, 1] }, { pos: [1, -1, 1] }
  ],
  D: [
    { pos: [-1, -1, 1] }, { pos: [0, -1, 1] }, { pos: [1, -1, 1] },
    { pos: [-1, -1, 0] }, { pos: [0, -1, 0] }, { pos: [1, -1, 0] },
    { pos: [-1, -1, -1] }, { pos: [0, -1, -1] }, { pos: [1, -1, -1] }
  ],
  L: [
    { pos: [-1, 1, -1] }, { pos: [-1, 1, 0] }, { pos: [-1, 1, 1] },
    { pos: [-1, 0, -1] }, { pos: [-1, 0, 0] }, { pos: [-1, 0, 1] },
    { pos: [-1, -1, -1] }, { pos: [-1, -1, 0] }, { pos: [-1, -1, 1] }
  ],
  B: [
    { pos: [1, 1, -1] }, { pos: [0, 1, -1] }, { pos: [-1, 1, -1] },
    { pos: [1, 0, -1] }, { pos: [0, 0, -1] }, { pos: [-1, 0, -1] },
    { pos: [1, -1, -1] }, { pos: [0, -1, -1] }, { pos: [-1, -1, -1] }
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
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
    this.isPlaying = false;
    this.currentMoveIndex = 0;
    this.solution = [];
    this.animationSpeed = 300;
    this.scrambleMoves = [];
    this.scrambleFacelet = null;
    this.currentStream = null;
    this.draggable = true;
    this.isDragging = false;
    this.mouseDownPos = { x: 0, y: 0 };

    this.init();
  }

  init() {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;

    this.scene = new THREE.Scene();
    this.scene.background = null;

    this.camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 100);
    this.camera.position.set(5, 4, 6);
    this.camera.lookAt(0, 0, 0);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputEncoding = THREE.sRGBEncoding;
    this.container.appendChild(this.renderer.domElement);

    this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.minDistance = 4;
    this.controls.maxDistance = 15;
    this.controls.addEventListener('change', () => this.onControlsChange());

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
    this.scene.add(ambientLight);

    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 0.3);
    hemiLight.position.set(0, 10, 0);
    this.scene.add(hemiLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(5, 10, 7);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 1024;
    dirLight.shadow.mapSize.height = 1024;
    dirLight.shadow.camera.near = 0.5;
    dirLight.shadow.camera.far = 50;
    dirLight.shadow.camera.left = -5;
    dirLight.shadow.camera.right = 5;
    dirLight.shadow.camera.top = 5;
    dirLight.shadow.camera.bottom = -5;
    dirLight.shadow.bias = -0.0001;
    this.scene.add(dirLight);

    const fillLight = new THREE.DirectionalLight(0xffffff, 0.3);
    fillLight.position.set(-5, 5, -5);
    this.scene.add(fillLight);

    // Floor
    const floorGeo = new THREE.PlaneGeometry(20, 20);
    const floorMat = new THREE.ShadowMaterial({ opacity: 0.15 });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -2.5;
    floor.receiveShadow = true;
    this.scene.add(floor);

    // Grid
    const grid = new THREE.GridHelper(10, 20, 0xdddddd, 0xeeeeee);
    grid.position.y = -2.49;
    grid.material.opacity = 0.3;
    grid.material.transparent = true;
    this.scene.add(grid);

    this.createCube();

    window.addEventListener('resize', () => this.onResize());
    this.renderer.domElement.addEventListener('mousedown', (e) => this.onMouseDown(e));
    this.renderer.domElement.addEventListener('mouseup', (e) => this.onMouseUp(e));
    this.renderer.domElement.addEventListener('touchstart', (e) => this.onTouchStart(e));
    this.renderer.domElement.addEventListener('touchend', (e) => this.onTouchEnd(e));

    this.animate();
  }

  createCube() {
    const geometry = new THREE.BoxGeometry(0.95, 0.95, 0.95);
    const stickerGeometry = new THREE.PlaneGeometry(0.85, 0.85);
    const stickerOffset = 0.48;

    for (let x = -1; x <= 1; x++) {
      for (let y = -1; y <= 1; y++) {
        for (let z = -1; z <= 1; z++) {
          const cubieMaterial = new THREE.MeshStandardMaterial({
            color: COLORS.interior,
            roughness: 0.5,
            metalness: 0.1
          });

          const cubie = new THREE.Mesh(geometry, cubieMaterial);
          cubie.position.set(x, y, z);
          cubie.castShadow = true;
          cubie.receiveShadow = true;
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
            const sticker = new THREE.Mesh(stickerGeometry, new THREE.MeshStandardMaterial({
              color: COLORS.interior,
              roughness: 0.35,
              metalness: 0.0,
              emissive: 0x000000,
              emissiveIntensity: 0.04
            }));
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

  // Click-to-rotate: detect which face was clicked and apply move
  onMouseDown(event) {
    this.mouseDownPos = { x: event.clientX, y: event.clientY };
    this.isDragging = false;
  }

  onMouseUp(event) {
    const dx = event.clientX - this.mouseDownPos.x;
    const dy = event.clientY - this.mouseDownPos.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    
    if (dist < 5) {
      // It was a click, not a drag
      this.handleClick(event);
    }
  }

  onTouchStart(event) {
    if (event.touches.length === 1) {
      this.mouseDownPos = { x: event.touches[0].clientX, y: event.touches[0].clientY };
      this.isDragging = false;
    }
  }

  onTouchEnd(event) {
    if (event.changedTouches.length === 1) {
      const dx = event.changedTouches[0].clientX - this.mouseDownPos.x;
      const dy = event.changedTouches[0].clientY - this.mouseDownPos.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      
      if (dist < 10) {
        this.handleClick(event.changedTouches[0]);
      }
    }
  }

  handleClick(event) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.camera);
    const intersects = this.raycaster.intersectObjects(this.cubies, true);

    if (intersects.length > 0) {
      const hit = intersects[0];
      const cubie = hit.object.parent instanceof THREE.Mesh ? hit.object.parent : hit.object;
      const sticker = hit.object;
      const face = sticker.userData.face;
      
      if (face) {
        // Determine click position on face to decide move direction
        const localPoint = hit.point.clone();
        cubie.worldToLocal(localPoint);
        
        // Get face normal in local space
        const normal = this.getFaceNormal(face);
        
        // Offset from center of face
        const offset = localPoint.clone().sub(new THREE.Vector3(
          normal.x * 0.5,
          normal.y * 0.5,
          normal.z * 0.5
        ));
        
        // Decide between clockwise and counter-clockwise based on click position
        const move = this.getMoveFromClick(face, offset, normal);
        if (move) {
          this.applyMove(move, true);
          if (this.onMoveApplied) this.onMoveApplied(move);
        }
      }
    }
  }

  getFaceNormal(face) {
    const normals = {
      'U': new THREE.Vector3(0, 1, 0),
      'D': new THREE.Vector3(0, -1, 0),
      'F': new THREE.Vector3(0, 0, 1),
      'B': new THREE.Vector3(0, 0, -1),
      'R': new THREE.Vector3(1, 0, 0),
      'L': new THREE.Vector3(-1, 0, 0)
    };
    return normals[face] || new THREE.Vector3(0, 0, 0);
  }

  getMoveFromClick(face, offset, normal) {
    // Determine if click is on one side or the other of the face diagonal
    // Simple heuristic: use the dominant axis of offset
    const absX = Math.abs(offset.x);
    const absY = Math.abs(offset.y);
    const absZ = Math.abs(offset.z);
    
    // For each face, determine clockwise vs counter-clockwise based on click position
    const prime = this.shouldPrime(face, offset, normal);
    return face + (prime ? "'" : '');
  }

  shouldPrime(face, offset, normal) {
    // Simple heuristic: use cross product of normal and offset
    const cross = new THREE.Vector3().crossVectors(normal, offset);
    
    switch (face) {
      case 'U': return cross.z > 0;
      case 'D': return cross.z < 0;
      case 'F': return cross.y > 0;
      case 'B': return cross.y < 0;
      case 'R': return cross.y < 0;
      case 'L': return cross.y > 0;
      default: return false;
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
    
    return Promise.resolve();
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
    this.scrambleFacelet = null;

    this.cubies.forEach(c => {
      c.rotation.set(0, 0, 0);
      const x = Math.round(c.position.x);
      const y = Math.round(c.position.y);
      const z = Math.round(c.position.z);
      c.userData.gridPos = { x, y, z };
    });

    this.updateStickers('UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB');
  }

  onControlsChange() {
    // Used by OrbitControls
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
