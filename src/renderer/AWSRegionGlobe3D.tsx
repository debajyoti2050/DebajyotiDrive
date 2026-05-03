import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';

export type AWSRegionPoint = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  status: 'ok' | 'warn' | 'error' | 'unknown';
};

type Props = {
  regions: AWSRegionPoint[];
  hoveredRegion: string | null;
  onHover: (id: string | null) => void;
};

const statusColors: Record<AWSRegionPoint['status'], string> = {
  ok: '#34d399',
  warn: '#fbbf24',
  error: '#f87171',
  unknown: '#9b5cf6',
};

function latLonToVector(lat: number, lon: number, radius: number) {
  const phi = (lat * Math.PI) / 180;
  const theta = (lon * Math.PI) / 180;
  return new THREE.Vector3(
    radius * Math.cos(phi) * Math.sin(theta),
    radius * Math.sin(phi),
    radius * Math.cos(phi) * Math.cos(theta)
  );
}

function makeLine(points: THREE.Vector3[], color: string, opacity: number) {
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  return new THREE.Line(
    geometry,
    new THREE.LineBasicMaterial({ color, transparent: true, opacity })
  );
}

function makeArc(a: THREE.Vector3, b: THREE.Vector3) {
  const mid = a.clone().add(b).multiplyScalar(0.5).normalize().multiplyScalar(2.35);
  return new THREE.QuadraticBezierCurve3(a, mid, b);
}

export const AWSRegionGlobe3D: React.FC<Props> = ({ regions, hoveredRegion, onHover }) => {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const hoveredRef = useRef<string | null>(hoveredRegion);

  useEffect(() => {
    hoveredRef.current = hoveredRegion;
  }, [hoveredRegion]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
    camera.position.set(0, 0.22, 5.7);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(renderer.domElement);

    const root = new THREE.Group();
    root.rotation.y = -0.8;
    root.rotation.x = -0.08;
    scene.add(root);

    scene.add(new THREE.AmbientLight('#7c3aed', 1.3));
    const key = new THREE.DirectionalLight('#c4b5fd', 2.2);
    key.position.set(3, 2.6, 4);
    scene.add(key);
    const cyan = new THREE.PointLight('#60a5fa', 4, 7);
    cyan.position.set(-2.4, 1.3, 2.8);
    scene.add(cyan);

    const globe = new THREE.Mesh(
      new THREE.SphereGeometry(1.72, 64, 32),
      new THREE.MeshStandardMaterial({
        color: '#170b2b',
        emissive: '#3d2070',
        emissiveIntensity: 0.34,
        roughness: 0.42,
        metalness: 0.08,
        transparent: true,
        opacity: 0.88,
      })
    );
    root.add(globe);

    const atmosphere = new THREE.Mesh(
      new THREE.SphereGeometry(1.82, 64, 32),
      new THREE.MeshBasicMaterial({
        color: '#9b5cf6',
        transparent: true,
        opacity: 0.12,
        side: THREE.BackSide,
      })
    );
    root.add(atmosphere);

    const wire = new THREE.LineSegments(
      new THREE.WireframeGeometry(new THREE.SphereGeometry(1.735, 24, 14)),
      new THREE.LineBasicMaterial({ color: '#7c3aed', transparent: true, opacity: 0.22 })
    );
    root.add(wire);

    const regionMeshes = new Map<string, THREE.Mesh>();
    const pointGeometry = new THREE.SphereGeometry(0.045, 18, 10);

    for (const region of regions) {
      const color = statusColors[region.status];
      const marker = new THREE.Mesh(
        pointGeometry,
        new THREE.MeshStandardMaterial({
          color,
          emissive: color,
          emissiveIntensity: 1.7,
          roughness: 0.2,
          metalness: 0.18,
        })
      );
      marker.position.copy(latLonToVector(region.lat, region.lon, 1.79));
      marker.userData.regionId = region.id;
      regionMeshes.set(region.id, marker);
      root.add(marker);

      const halo = new THREE.Mesh(
        new THREE.SphereGeometry(0.08, 18, 10),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.14 })
      );
      marker.add(halo);
    }

    const importantLinks = [
      ['us-east-1', 'eu-west-1'],
      ['us-east-1', 'us-west-2'],
      ['eu-west-1', 'ap-south-1'],
      ['ap-south-1', 'ap-southeast-1'],
      ['ap-southeast-1', 'ap-northeast-1'],
      ['ap-southeast-1', 'ap-southeast-2'],
      ['eu-central-1', 'me-south-1'],
      ['eu-west-1', 'sa-east-1'],
    ];

    const arcs: { curve: THREE.QuadraticBezierCurve3; pulse: THREE.Mesh; offset: number }[] = [];
    importantLinks.forEach(([from, to], index) => {
      const a = regions.find(region => region.id === from);
      const b = regions.find(region => region.id === to);
      if (!a || !b) return;
      const curve = makeArc(latLonToVector(a.lat, a.lon, 1.83), latLonToVector(b.lat, b.lon, 1.83));
      root.add(makeLine(curve.getPoints(48), index % 2 ? '#60a5fa' : '#34d399', 0.42));
      const pulse = new THREE.Mesh(
        new THREE.SphereGeometry(0.035, 14, 8),
        new THREE.MeshBasicMaterial({ color: index % 2 ? '#60a5fa' : '#34d399' })
      );
      root.add(pulse);
      arcs.push({ curve, pulse, offset: index * 0.13 });
    });

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const onPointerMove = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(Array.from(regionMeshes.values()), false)[0];
      onHover(hit?.object.userData.regionId ?? null);
    };
    const onPointerLeave = () => onHover(null);
    renderer.domElement.addEventListener('pointermove', onPointerMove);
    renderer.domElement.addEventListener('pointerleave', onPointerLeave);

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
      root.rotation.y = -0.8 + elapsed * 0.13;
      atmosphere.rotation.y = elapsed * -0.08;
      wire.rotation.y = elapsed * 0.05;

      for (const [id, mesh] of regionMeshes) {
        const active = hoveredRef.current === id;
        const base = active ? 1.7 : 1 + Math.sin(elapsed * 2.3 + mesh.position.x * 3) * 0.08;
        mesh.scale.setScalar(base);
      }

      arcs.forEach((arc) => {
        const point = arc.curve.getPoint((elapsed * 0.15 + arc.offset) % 1);
        arc.pulse.position.copy(point);
        arc.pulse.scale.setScalar(0.8 + Math.sin(elapsed * 4 + arc.offset * 12) * 0.24);
      });

      renderer.render(scene, camera);
      frameId = window.requestAnimationFrame(tick);
    };

    if (prefersReducedMotion) renderer.render(scene, camera);
    else frameId = window.requestAnimationFrame(tick);

    return () => {
      if (frameId) window.cancelAnimationFrame(frameId);
      renderer.domElement.removeEventListener('pointermove', onPointerMove);
      renderer.domElement.removeEventListener('pointerleave', onPointerLeave);
      resizeObserver.disconnect();
      host.removeChild(renderer.domElement);
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.LineSegments) {
          object.geometry.dispose();
          const material = object.material;
          if (Array.isArray(material)) material.forEach(item => item.dispose());
          else material.dispose();
        }
      });
      renderer.dispose();
    };
  }, [onHover, regions]);

  return <div className="aws-region-globe-3d" ref={hostRef} />;
};
