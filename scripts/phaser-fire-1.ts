declare module '@meta/horizon-worlds' {
  export class Player {
    readonly dominantHand: string;
    readonly transform: Transform;
    readonly isLocal: boolean;
    
    getHandTransform(handType: string): Transform;
    getHandWorldPosition(handType: string): [number, number, number];
    getInputValue(handType: string, inputName: string): number;
    getJointWorldPosition(jointName: string): [number, number, number];
  }
  
  export class Object3D {
    readonly transform: Transform;
    material: Material;
    enabled: boolean;
    
    subscribeTo(eventName: string, callback: Function): void;
    emit(eventName: string, ...args: any[]): void;
    hasTag(tagName: string): boolean;
    destroy(): void;
  }
  
  export class ObjectFactory {
    static createSphere(): Object3D;
    static createCylinder(): Object3D;
    static loadModel(modelPath: string): Object3D;
  }
  
  export class Transform {
    parent: Transform | null;
    position: [number, number, number];
    rotation: [number, number, number, number];
    localPosition: [number, number, number];
    localRotation: [number, number, number, number];
    localScale: [number, number, number];
    worldPosition: [number, number, number];
    forward: [number, number, number];
    
    static eulerToQuaternion(x: number, y: number, z: number): [number, number, number, number];
  }
  
  export class Material {
    emissiveColor: [number, number, number];
    opacity: number;
  }
  
  export interface RaycastHit {
    object: Object3D;
    distance: number;
    point: [number, number, number];
  }
  
  export abstract class PlayerScript {
    subscribeTo(eventName: string, callback: Function): void;
    abstract onPlayerJoined(player: Player): void;
  }
  
  export class Scene {
    static time: number;
    static playSound(sound: SoundDefinition, position: [number, number, number], options?: {volume?: number, loop?: boolean}): void;
    static loadSound(soundPath: string): SoundDefinition;
    static raycast(origin: [number, number, number], direction: [number, number, number], maxDistance: number): RaycastHit | null;
    static getObjectsInSphere(position: [number, number, number], radius: number): Object3D[];
    static setTimeout(callback: Function, delay: number): void;
    static register(name: string, scriptClass: any): void;
  }
  
  export interface SoundDefinition {}
  
  export class Haptics {
    static vibrate(player: Player, handType: string, intensity: number, duration: number): void;
  }
}

import { Player, Object3D, ObjectFactory, Transform, PlayerScript, RaycastHit, Scene, SoundDefinition, Haptics } from '@meta/horizon-worlds';

class PhaserWeapon extends PlayerScript {
  // Properties
  private readonly model: Object3D;
  private readonly phaserSound: SoundDefinition;
  private readonly fireTrigger: number = 0.7; // Trigger threshold for firing
  private readonly damageDPS: number = 5;
  private readonly beamColor: [number, number, number] = [0, 100, 255]; // Blue color for beam
  private readonly beamWidth: number = 0.01;
  private readonly beamMaxLength: number = 30;
  private readonly effectRadius: number = 0.05; // Area of effect at impact point
  
  private owner: Player | null = null;
  private isEquipped: boolean = false;
  private isFiring: boolean = false;
  private beamObject: Object3D | null = null;
  private lastFireTime: number = 0;
  private holsterPosition: Transform | null = null;

  constructor() {
    super();
    // Load the phaser model
    this.model = ObjectFactory.loadModel("phaser_weapon.fbx");
    this.model.transform.localScale = [0.5, 0.5, 0.5]; // Adjust scale as needed
    
    // Load the phaser sound
    this.phaserSound = Scene.loadSound("hand_phaser_clean.wav");
    
    // Create beam object (initially invisible)
    this.createBeamEffect();
    
    // Set up interaction handlers
    this.setupInteractionHandlers();
  }
  
  private createBeamEffect(): void {
    this.beamObject = ObjectFactory.createCylinder();
    this.beamObject.material.emissiveColor = this.beamColor;
    this.beamObject.material.opacity = 0.7;
    this.beamObject.enabled = false;
    this.beamObject.transform.parent = this.model.transform;
  }
  
  private setupInteractionHandlers(): void {
    // Setup grab interaction
    this.model.subscribeTo('onGrab', (player: Player, handType: string) => {
      this.equip(player, handType);
      Haptics.vibrate(player, handType, 0.5, 0.2); // Grab feedback
    });
    
    // Setup release interaction
    this.model.subscribeTo('onRelease', (player: Player) => {
      if (this.isEquipped && player === this.owner) {
        // Check if near hip for holstering
        if (this.isNearHolsterPosition(player)) {
          this.holster(player);
        } else {
          this.unequip();
        }
        Haptics.vibrate(player, player.dominantHand, 0.3, 0.1); // Release feedback
      }
    });

    // Process updates every frame
    this.subscribeTo('update', () => this.update());
  }
  
  private equip(player: Player, handType: string): void {
    this.owner = player;
    this.isEquipped = true;
    
    // Store holster position based on player's hip
    if (!this.holsterPosition) {
      const hipPosition = player.getJointWorldPosition('Hip');
      this.holsterPosition = new Transform();
      this.holsterPosition.position = [hipPosition[0] + 0.15, hipPosition[1], hipPosition[2]];
    }
    
    // Attach to player's hand
    const hand = player.getHandTransform(handType);
    this.model.transform.parent = hand;
    this.model.transform.localPosition = [0, 0, -0.05];
    this.model.transform.localRotation = [0, 0, 0, 1]; // Quaternion format
  }
  
  private unequip(): void {
    if (this.owner) {
      this.model.transform.parent = null;
      this.stopFiring();
      this.isEquipped = false;
      this.owner = null;
    }
  }
  
  private holster(player: Player): void {
    if (this.holsterPosition) {
      this.model.transform.parent = player.transform;
      this.model.transform.worldPosition = this.holsterPosition.position;
      this.model.transform.localRotation = Transform.eulerToQuaternion(0, 90, 0); // Convert Euler to quaternion
      this.stopFiring();
      this.isEquipped = true;
    }
  }
  
  private isNearHolsterPosition(player: Player): boolean {
    if (!this.holsterPosition) return false;
    
    const handPos = player.getHandWorldPosition(player.dominantHand);
    const holsterPos = this.holsterPosition.position;
    
    // Check distance to holster position
    const dx = handPos[0] - holsterPos[0];
    const dy = handPos[1] - holsterPos[1];
    const dz = handPos[2] - holsterPos[2];
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
    
    return distance < 0.2; // Threshold for holstering
  }
  
  private update(): void {
    if (!this.isEquipped || !this.owner) return;
    
    // Check trigger input for firing
    const triggerValue = this.owner.getInputValue(this.owner.dominantHand, 'trigger');
    
    if (triggerValue >= this.fireTrigger && !this.isFiring) {
      this.startFiring();
    } else if (triggerValue < this.fireTrigger && this.isFiring) {
      this.stopFiring();
    }
    
    // Update beam while firing
    if (this.isFiring) {
      this.updateBeam();
    }
  }
  
  private startFiring(): void {
    this.isFiring = true;
    if (this.beamObject) {
      this.beamObject.enabled = true;
    }
    
    // Play phaser sound
    Scene.playSound(this.phaserSound, this.model.transform.worldPosition, { volume: 1.0, loop: false });
    
    // Haptic feedback for firing
    if (this.owner) {
      Haptics.vibrate(
        this.owner, 
        this.owner.dominantHand, 
        0.7, 
        0.1
      );
    }
    
    this.lastFireTime = Scene.time;
  }
  
  private stopFiring(): void {
    this.isFiring = false;
    if (this.beamObject) {
      this.beamObject.enabled = false;
    }
  }
  
  private updateBeam(): void {
    if (!this.beamObject || !this.owner) return;
    
    // Calculate beam direction from phaser
    const startPos = this.model.transform.worldPosition;
    const forward = this.model.transform.forward;
    
    // Cast ray to detect hits
    const hit: RaycastHit | null = Scene.raycast(startPos, forward, this.beamMaxLength);
    const beamLength = hit ? hit.distance : this.beamMaxLength;
    
    // Update beam appearance
    this.beamObject.transform.localPosition = [0, 0, -beamLength / 2];
    this.beamObject.transform.localScale = [this.beamWidth, beamLength, this.beamWidth];
    
    // Apply damage to hit object if it's damageable
    if (hit && hit.object.hasTag("damageable")) {
      const currentTime = Scene.time;
      const deltaTime = (currentTime - this.lastFireTime) / 1000; // Convert to seconds
      const damage = this.damageDPS * deltaTime;
      
      // Apply damage to target using event system
      hit.object.emit('damage', damage);
      
      // Apply area effect damage
      this.applyAreaEffectDamage(hit.point, damage * 0.5);
      
      this.lastFireTime = currentTime;
      
      // Visual impact effect at hit point
      this.createImpactEffect(hit.point);
    }
  }
  
  private applyAreaEffectDamage(position: [number, number, number], damage: number): void {
    // Find all damageable objects in radius
    const nearbyObjects = Scene.getObjectsInSphere(position, this.effectRadius);
    
    for (const obj of nearbyObjects) {
      if (obj.hasTag("damageable") && obj !== this.model) {
        // Calculate distance-based damage falloff
        const objPos = obj.transform.worldPosition;
        const dx = position[0] - objPos[0];
        const dy = position[1] - objPos[1];
        const dz = position[2] - objPos[2];
        const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
        const falloff = 1 - (distance / this.effectRadius);
        const scaledDamage = damage * Math.max(0, falloff);
        
        if (scaledDamage > 0) {
          obj.emit('damage', scaledDamage);
        }
      }
    }
  }
  
  private createImpactEffect(position: [number, number, number]): void {
    // Create impact particle effect
    const impactEffect = ObjectFactory.createSphere();
    impactEffect.transform.worldPosition = position;
    impactEffect.transform.localScale = [this.effectRadius, this.effectRadius, this.effectRadius];
    impactEffect.material.emissiveColor = this.beamColor;
    impactEffect.material.opacity = 0.6;
    
    // Fade out and destroy effect
    Scene.setTimeout(() => {
      impactEffect.destroy();
    }, 300);
  }

  // Required method for PlayerScript subclass
  onPlayerJoined(player: Player): void {
    if (player.isLocal) {
      // Make sure the phaser is available to the local player
      this.model.enabled = true;
    }
  }
}

// Register the script with the system
Scene.register('PhaserWeapon', PhaserWeapon);
