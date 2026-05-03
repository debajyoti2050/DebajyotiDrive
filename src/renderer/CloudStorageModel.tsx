import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';

type DataParticle = {
  curve: THREE.Curve<THREE.Vector3>;
  mesh: THREE.Mesh;
  offset: number;
  speed: number;
};

const palette = {
  ink: '#10081c',
  shell: '#1b102c',
  slab: '#281643',
  slabTop: '#44206f',
  violet: '#9b5cf6',
  violetSoft: '#6d28d9',
  blue: '#60a5fa',
  teal: '#34d399',
  amber: '#ff9900',
};

function makeStandard(color: string, options: Partial<THREE.MeshStandardMaterialParameters> = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.46,
    metalness: 0.28,
    ...options,
  });
}

function addEdgeGlow(mesh: THREE.Mesh, color = palette.violet) {
  const edges = new THREE.EdgesGeometry(mesh.geometry);
  const lines = new THREE.LineSegments(
    edges,
    new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.32 })
  );
  lines.scale.copy(mesh.scale);
  mesh.add(lines);
}

function createDriveStack() {
  const group = new THREE.Group();
  const slabMaterial = makeStandard(palette.slab, {
    emissive: palette.ink,
    emissiveIntensity: 0.35,
  });
  const topMaterial = makeStandard(palette.slabTop, {
    emissive: '#170925',
    emissiveIntensity: 0.24,
  });

  for (let i = 0; i < 3; i += 1) {
    const slab = new THREE.Mesh(new THREE.BoxGeometry(2.7, 0.24, 1.36), slabMaterial);
    slab.position.set(0, i * 0.29, 0);
    slab.castShadow = true;
    slab.receiveShadow = true;
    addEdgeGlow(slab, i === 1 ? palette.blue : palette.violet);
    group.add(slab);

    const top = new THREE.Mesh(new THREE.BoxGeometry(2.46, 0.018, 1.1), topMaterial);
    top.position.set(0, i * 0.29 + 0.132, -0.02);
    group.add(top);

    const slot = new THREE.Mesh(
      new THREE.BoxGeometry(1.62, 0.018, 0.026),
      makeStandard('#0b0712', { emissive: palette.violet, emissiveIntensity: 0.6 })
    );
    slot.position.set(-0.14, i * 0.29 + 0.01, 0.696);
    group.add(slot);

    [palette.teal, palette.violet, palette.amber].forEach((color, dotIndex) => {
      const dot = new THREE.Mesh(
        new THREE.SphereGeometry(0.045, 18, 10),
        makeStandard(color, { emissive: color, emissiveIntensity: 1.4 })
      );
      dot.position.set(0.86 + dotIndex * 0.18, i * 0.29 + 0.02, 0.712);
      group.add(dot);
    });
  }

  group.position.set(0, -1.18, 0);
  group.rotation.x = -0.04;
  return group;
}

function createCloud() {
  const group = new THREE.Group();
  const cloudMaterial = makeStandard(palette.violetSoft, {
    metalness: 0.06,
    roughness: 0.34,
    transparent: true,
    opacity: 0.74,
    emissive: palette.violet,
    emissiveIntensity: 0.38,
  });
  const cloudPieces = [
    { position: [-0.62, 0, 0], scale: [0.72, 0.52, 0.46] },
    { position: [0.08, 0.07, 0], scale: [0.9, 0.6, 0.52] },
    { position: [0.78, -0.02, 0], scale: [0.64, 0.48, 0.42] },
    { position: [-0.18, 0.43, -0.02], scale: [0.56, 0.56, 0.5] },
    { position: [0.42, 0.34, 0.02], scale: [0.52, 0.52, 0.46] },
  ];

  for (const piece of cloudPieces) {
    const sphere = new THREE.Mesh(new THREE.SphereGeometry(0.72, 32, 18), cloudMaterial);
    sphere.position.set(piece.position[0], piece.position[1], piece.position[2]);
    sphere.scale.set(piece.scale[0], piece.scale[1], piece.scale[2]);
    group.add(sphere);
  }

  const base = new THREE.Mesh(
    new THREE.BoxGeometry(1.85, 0.42, 0.72),
    makeStandard(palette.violetSoft, {
      metalness: 0.08,
      roughness: 0.32,
      transparent: true,
      opacity: 0.66,
      emissive: palette.violet,
      emissiveIntensity: 0.28,
    })
  );
  base.position.set(0.08, -0.29, 0);
  addEdgeGlow(base, palette.blue);
  group.add(base);

  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(1.34, 0.018, 12, 96),
    makeStandard(palette.blue, { emissive: palette.blue, emissiveIntensity: 1.2 })
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = -0.18;
  group.add(ring);

  group.position.set(0.06, 0.66, 0);
  return group;
}

function createTube(curve: THREE.Curve<THREE.Vector3>, color: string) {
  return new THREE.Mesh(
    new THREE.TubeGeometry(curve, 72, 0.012, 8, false),
    makeStandard(color, {
      metalness: 0.02,
      roughness: 0.2,
      transparent: true,
      opacity: 0.52,
      emissive: color,
      emissiveIntensity: 1.4,
    })
  );
}

export const CloudStorageModel: React.FC = () => {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
    camera.position.set(0.28, 0.55, 6.15);
    camera.lookAt(0.22, -0.18, 0);

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    } catch {
      host.classList.add('cloud-storage-model-fallback');
      return;
    }

    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(renderer.domElement);

    scene.add(new THREE.AmbientLight('#6d28d9', 1.25));

    const keyLight = new THREE.DirectionalLight('#b07ef9', 2.4);
    keyLight.position.set(3.2, 3.6, 4.8);
    scene.add(keyLight);

    const rimLight = new THREE.PointLight('#60a5fa', 7, 9);
    rimLight.position.set(-2.7, 0.4, 2.4);
    scene.add(rimLight);

    const amberLight = new THREE.PointLight('#ff9900', 4.2, 8);
    amberLight.position.set(2.2, -0.2, 2.4);
    scene.add(amberLight);

    const root = new THREE.Group();
    root.rotation.y = -0.42;
    root.rotation.x = 0.04;
    root.position.set(0.68, -0.03, 0);
    scene.add(root);

    const driveStack = createDriveStack();
    const cloud = createCloud();
    root.add(driveStack, cloud);

    const curves: THREE.Curve<THREE.Vector3>[] = [
      new THREE.CubicBezierCurve3(
        new THREE.Vector3(-0.92, -0.62, 0.34),
        new THREE.Vector3(-1.42, -0.06, 0.12),
        new THREE.Vector3(-0.82, 0.56, 0.12),
        new THREE.Vector3(-0.26, 0.78, 0.08)
      ),
      new THREE.CubicBezierCurve3(
        new THREE.Vector3(0.02, -0.54, 0.36),
        new THREE.Vector3(0.34, -0.04, 0.58),
        new THREE.Vector3(0.5, 0.42, 0.28),
        new THREE.Vector3(0.36, 0.82, 0.08)
      ),
      new THREE.CubicBezierCurve3(
        new THREE.Vector3(0.88, -0.6, 0.32),
        new THREE.Vector3(1.44, -0.16, 0.04),
        new THREE.Vector3(1.02, 0.48, -0.12),
        new THREE.Vector3(0.62, 0.72, 0.04)
      ),
    ];
    curves.forEach((curve, index) => root.add(createTube(curve, [palette.violet, palette.blue, palette.amber][index])));

    const particleGeometry = new THREE.SphereGeometry(0.045, 16, 8);
    const particles: DataParticle[] = curves.map((curve, index) => {
      const color = [palette.teal, palette.blue, palette.amber][index];
      const mesh = new THREE.Mesh(
        particleGeometry,
        makeStandard(color, { emissive: color, emissiveIntensity: 1.8, metalness: 0.08 })
      );
      root.add(mesh);
      return { curve, mesh, offset: index * 0.27, speed: 0.055 + index * 0.018 };
    });

    const orbitGroup = new THREE.Group();
    const cubeMaterial = makeStandard(palette.slabTop, {
      transparent: true,
      opacity: 0.82,
      emissive: palette.violet,
      emissiveIntensity: 0.28,
    });
    for (let i = 0; i < 6; i += 1) {
      const cube = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.12), cubeMaterial);
      const angle = (Math.PI * 2 * i) / 6;
      cube.position.set(Math.cos(angle) * 1.52, 0.22 + Math.sin(i) * 0.1, Math.sin(angle) * 0.5);
      cube.rotation.set(angle, angle * 0.7, angle * 0.5);
      orbitGroup.add(cube);
    }
    orbitGroup.position.set(0.08, 0.28, 0);
    root.add(orbitGroup);

    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(1.95, 72),
      new THREE.MeshBasicMaterial({ color: palette.ink, transparent: true, opacity: 0.34 })
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.set(0, -1.38, 0);
    root.add(shadow);

    const resize = () => {
      const width = Math.max(host.clientWidth, 1);
      const height = Math.max(host.clientHeight, 1);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
      renderer.render(scene, camera);
    };

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(host);
    resize();

    let frameId = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const elapsed = (now - start) / 1000;
      root.rotation.y = -0.42 + Math.sin(elapsed * 0.36) * 0.12;
      root.rotation.x = 0.04 + Math.sin(elapsed * 0.22) * 0.035;
      cloud.position.y = 0.66 + Math.sin(elapsed * 1.05) * 0.08;
      driveStack.position.y = -1.18 + Math.sin(elapsed * 0.78) * 0.025;
      orbitGroup.rotation.y = elapsed * 0.34;
      orbitGroup.rotation.z = Math.sin(elapsed * 0.28) * 0.12;

      particles.forEach((particle) => {
        const loopProgress = (elapsed * particle.speed + particle.offset) % 1;
        const point = particle.curve.getPoint(0.02 + loopProgress * 0.96);
        particle.mesh.position.copy(point);
        particle.mesh.scale.setScalar(0.78 + Math.sin(elapsed * 4 + particle.offset * 10) * 0.22);
      });

      renderer.render(scene, camera);
      frameId = window.requestAnimationFrame(tick);
    };

    if (prefersReducedMotion) {
      renderer.render(scene, camera);
    } else {
      frameId = window.requestAnimationFrame(tick);
    }

    return () => {
      if (frameId) window.cancelAnimationFrame(frameId);
      resizeObserver.disconnect();
      host.removeChild(renderer.domElement);
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) {
          object.geometry.dispose();
          const material = object.material;
          if (Array.isArray(material)) material.forEach(item => item.dispose());
          else material.dispose();
        }
      });
      renderer.dispose();
    };
  }, []);

  return <div className="cloud-storage-model" ref={hostRef} aria-hidden />;
};
