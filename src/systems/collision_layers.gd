## Masques des couches de physique 2D, nommes une seule fois pour tout le jeu.
##
## Regle D.2.2 : aucun nombre magique. Personne n'ecrit `collision_mask = 5`,
## on ecrit `CollisionLayers.WORLD | CollisionLayers.ENEMY`.
## Les noms correspondent exactement a `[layer_names]` dans project.godot.
class_name CollisionLayers
extends RefCounted

const WORLD: int = 1 << 0            ## 1   - sol et murs pleins
const ONE_WAY: int = 1 << 1          ## 2   - plateformes traversables par le bas
const PLAYER: int = 1 << 2           ## 4   - corps de SORIO
const PLAYER_HURTBOX: int = 1 << 3   ## 8   - zone qui recoit les degats
const ENEMY: int = 1 << 4            ## 16  - corps des ennemis
const PLAYER_PROJECTILE: int = 1 << 5 ## 32  - projectiles tires par SORIO
const ENEMY_PROJECTILE: int = 1 << 6 ## 64  - projectiles tires par les ennemis
const PICKUP: int = 1 << 7           ## 128 - ambres, cristaux, objets
const HAZARD: int = 1 << 8           ## 256 - pics, lave, eau mortelle
const TRIGGER: int = 1 << 9          ## 512 - declencheurs de didacticiel et de zone
const ALLY: int = 1 << 10            ## 1024 - entites invoquees amies
const BREAKABLE: int = 1 << 11       ## 2048 - blocs cassables

## Tout ce qui arrete un deplacement horizontal ou vertical vers le bas.
const SOLID_ALL: int = WORLD | ONE_WAY | BREAKABLE

## Noms lisibles, utilises par le panneau de debug et les messages d'erreur.
const NAMES: Dictionary = {
	WORLD: "world",
	ONE_WAY: "one_way",
	PLAYER: "player",
	PLAYER_HURTBOX: "player_hurtbox",
	ENEMY: "enemy",
	PLAYER_PROJECTILE: "player_projectile",
	ENEMY_PROJECTILE: "enemy_projectile",
	PICKUP: "pickup",
	HAZARD: "hazard",
	TRIGGER: "trigger",
	ALLY: "ally",
	BREAKABLE: "breakable",
}

## Retourne la liste des noms de couches contenues dans un masque.
static func describe(mask: int) -> String:
	var found: PackedStringArray = PackedStringArray()
	for bit: int in NAMES:
		if mask & bit:
			found.append(String(NAMES[bit]))
	if found.is_empty():
		return "(aucune)"
	return ", ".join(found)
