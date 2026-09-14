import { getGroundMaterial, raycastWorld } from '../shared/physics.js';

export const CS2_STEP_INTERVAL = 1.85; // Distance in meters between footsteps in CS2
export const CS2_MAX_AUDIBLE_DISTANCE = 25.0; // Max audible radius (~1000 Source units)
export const CS2_RUN_SPEED_THRESHOLD = 2.5; // Walking speed cap is ~3.3 m/s; running is > 3.4 m/s
export const CS2_HARD_LAND_VELOCITY = -5.2; // Downward velocity threshold for heavy landing
export const CS2_SOFT_LAND_VELOCITY = -1.5; // Downward velocity threshold for soft landing

export class FootstepAudioSystem {
  constructor(audio) {
    this.audio = audio;
    this.lastStepDistance = 0;
    this.localFootIsLeft = false;
    this.localWasGrounded = true;
    this.localLastVy = 0;
    this.stepCount = 0;
    this.landCount = 0;
    this.remoteStepCount = 0;
    this.remotePlayers = new Map();
  }

  reset() {
    this.lastStepDistance = 0;
    this.localFootIsLeft = false;
    this.localWasGrounded = true;
    this.localLastVy = 0;
    this.remotePlayers.clear();
  }

  update(dt, self, renderPlayers = [], camera, listenerYaw = 0, { controlsEnabled = true, spectating = null } = {}) {
    if (!this.audio) return;

    // 1. Local Player Footstep & Landing Logic
    if (self && self.alive) {
      const speed = Math.hypot(self.vx || 0, self.vz || 0);
      // In CS2, crouching or shift-walking is 100% silent
      const isSilent = self.crouch || self.walk || speed < CS2_RUN_SPEED_THRESHOLD;

      if (self.grounded && controlsEnabled && !isSilent) {
        const currentDist = self.stepDistance || 0;
        const delta = currentDist - this.lastStepDistance;
        if (delta < 0 || delta > 10) {
          this.lastStepDistance = currentDist;
        } else if (delta >= CS2_STEP_INTERVAL) {
          this.lastStepDistance = currentDist;
          this.localFootIsLeft = !this.localFootIsLeft;
          const material = getGroundMaterial(self.x, self.y, self.z);
          this.audio.footstep({
            material,
            distance: 0,
            isLeft: this.localFootIsLeft,
          });
          this.stepCount++;
        }
      } else {
        this.lastStepDistance = self.stepDistance || 0;
      }

      // Jump takeoff sound
      if (this.localWasGrounded && !self.grounded && (self.vy || 0) > 1.5 && controlsEnabled) {
        this.audio.jump({ distance: 0 });
      }

      // Landing sound
      if (!this.localWasGrounded && self.grounded) {
        const vy = this.localLastVy;
        if (vy <= CS2_SOFT_LAND_VELOCITY) {
          const hard = vy <= CS2_HARD_LAND_VELOCITY;
          const material = getGroundMaterial(self.x, self.y, self.z);
          this.audio.land({ material, hard, distance: 0 });
          this.landCount++;
        }
      }

      this.localWasGrounded = Boolean(self.grounded);
      this.localLastVy = self.vy || 0;
    }

    // 2. Remote Players Footstep & Landing Logic
    if (camera && renderPlayers?.length) {
      const camPos = camera.position;
      const now = performance.now();

      for (const p of renderPlayers) {
        // Skip local player or dead players
        if (!p.alive || (self && p.id === self.id && !spectating)) continue;
        // If spectating this player in first-person, footsteps are played at distance 0
        const isSpectatedFirstPerson = spectating && spectating.id === p.id;

        let tracker = this.remotePlayers.get(p.id);
        if (!tracker) {
          tracker = {
            lastX: p.x,
            lastY: p.y,
            lastZ: p.z,
            stepAccum: 0,
            isLeft: false,
            wasGrounded: Boolean(p.grounded),
            lastVy: p.vy || 0,
            lastActive: now,
          };
          this.remotePlayers.set(p.id, tracker);
        }
        tracker.lastActive = now;

        const dx = p.x - tracker.lastX;
        const dz = p.z - tracker.lastZ;
        const moveDist = Math.hypot(dx, dz);
        const speed = dt > 0 ? moveDist / dt : 0;
        tracker.lastX = p.x;
        tracker.lastY = p.y;
        tracker.lastZ = p.z;

        // Reset step accumulator if player teleported or respawned
        if (moveDist > 2.5) {
          tracker.stepAccum = 0;
        }

        // Stealth check: crouch or walk or stationary is completely silent
        const isSilent = p.crouch || p.walk || speed < CS2_RUN_SPEED_THRESHOLD || speed > 12.0;

        if (p.grounded && !isSilent) {
          tracker.stepAccum += moveDist;
          if (tracker.stepAccum >= CS2_STEP_INTERVAL) {
            tracker.stepAccum %= CS2_STEP_INTERVAL;
            tracker.isLeft = !tracker.isLeft;

            const dist = isSpectatedFirstPerson
              ? 0
              : Math.hypot(p.x - camPos.x, p.y - camPos.y, p.z - camPos.z);

            if (dist <= CS2_MAX_AUDIBLE_DISTANCE) {
              let pan = 0;
              let occluded = false;

              if (!isSpectatedFirstPerson) {
                const relX = p.x - camPos.x;
                const relZ = p.z - camPos.z;
                const horizDist = Math.max(0.001, Math.hypot(relX, relZ));
                pan = (relX * Math.cos(listenerYaw) - relZ * Math.sin(listenerYaw)) / horizDist;

                // Wall occlusion check
                const dir = { x: p.x - camPos.x, y: (p.y + 0.9) - camPos.y, z: p.z - camPos.z };
                const hitDist = raycastWorld(camPos, dir, dist - 0.4);
                occluded = hitDist !== null && hitDist < dist - 0.6;
              }

              const material = getGroundMaterial(p.x, p.y, p.z);
              this.audio.footstep({
                material,
                distance: dist,
                pan,
                isLeft: tracker.isLeft,
                occluded,
              });
              this.remoteStepCount++;
            }
          }
        } else if (p.crouch || p.walk || speed < 1.0) {
          tracker.stepAccum = 0;
        }

        // Remote jump takeoff
        if (tracker.wasGrounded && !p.grounded && (p.vy || 0) > 1.5) {
          const dist = isSpectatedFirstPerson
            ? 0
            : Math.hypot(p.x - camPos.x, p.y - camPos.y, p.z - camPos.z);
          if (dist <= 16.0) {
            let pan = 0;
            if (!isSpectatedFirstPerson) {
              const relX = p.x - camPos.x;
              const relZ = p.z - camPos.z;
              pan = (relX * Math.cos(listenerYaw) - relZ * Math.sin(listenerYaw)) / Math.max(0.001, Math.hypot(relX, relZ));
            }
            this.audio.jump({ distance: dist, pan });
          }
        }

        // Remote landing sound
        if (!tracker.wasGrounded && p.grounded) {
          const vy = tracker.lastVy;
          if (vy <= CS2_SOFT_LAND_VELOCITY) {
            const hard = vy <= CS2_HARD_LAND_VELOCITY;
            const maxDist = hard ? 30.0 : 25.0;
            const dist = isSpectatedFirstPerson
              ? 0
              : Math.hypot(p.x - camPos.x, p.y - camPos.y, p.z - camPos.z);

            if (dist <= maxDist) {
              let pan = 0;
              let occluded = false;
              if (!isSpectatedFirstPerson) {
                const relX = p.x - camPos.x;
                const relZ = p.z - camPos.z;
                pan = (relX * Math.cos(listenerYaw) - relZ * Math.sin(listenerYaw)) / Math.max(0.001, Math.hypot(relX, relZ));

                const dir = { x: p.x - camPos.x, y: (p.y + 0.5) - camPos.y, z: p.z - camPos.z };
                const hitDist = raycastWorld(camPos, dir, dist - 0.4);
                occluded = hitDist !== null && hitDist < dist - 0.6;
              }

              const material = getGroundMaterial(p.x, p.y, p.z);
              this.audio.land({ material, hard, distance: dist, pan, occluded });
            }
          }
        }

        tracker.wasGrounded = Boolean(p.grounded);
        tracker.lastVy = p.vy || 0;
      }

      // Periodic cleanup of stale remote players
      if (this.remotePlayers.size > 20) {
        for (const [id, tracker] of this.remotePlayers) {
          if (now - tracker.lastActive > 8000) this.remotePlayers.delete(id);
        }
      }
    }
  }

  status() {
    return {
      stepCount: this.stepCount,
      landCount: this.landCount,
      remoteStepCount: this.remoteStepCount,
      trackedRemotePlayers: this.remotePlayers.size,
    };
  }
}
