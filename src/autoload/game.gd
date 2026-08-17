extends Node
## Etat de la partie en cours (B.3).
##
## ATTENTION : ce fichier ne contient AUCUNE logique de gameplay. Il ne sait
## pas comment on perd un PV, seulement combien il en reste. La logique vit
## dans les systemes ; ici on ne stocke que l'etat et on emet les signaux.

## PV de base de SORIO ; l'amelioration permanente "+1 PV max" s'ajoute par-dessus.
const BASE_MAX_HEALTH: int = 3
const AMBER_PER_LIFE: int = 100
const CONTINUE_COST: int = 50

# --- Session ----------------------------------------------------------------

## Sauvegarde active. Jamais nulle en jeu : l'ecran de selection la remplit.
var save: SaveData = null
var current_slot: int = 1

# --- Etat du niveau en cours ------------------------------------------------

var world_index: int = 1
var level_index: int = 1
var health: int = BASE_MAX_HEALTH
var max_health: int = BASE_MAX_HEALTH
var level_elapsed: float = 0.0
var level_time_limit: float = 0.0
var checkpoint_index: int = -1
var hidden_ambers_found: int = 0
var level_amber: int = 0

## Pouvoirs : `active_power` est celui qui repond au bouton B,
## `pocket_power` celui qu'on echange (A.6).
var active_power: StringName = &""
var pocket_power: StringName = &""

var is_in_level: bool = false
var is_paused: bool = false


func _ready() -> void:
	# Une partie non chargee reste jouable (scenes de test, outils headless).
	if save == null:
		save = SaveData.new()


# --- Cycle de partie --------------------------------------------------------

func begin_session(data: SaveData, slot: int) -> void:
	assert(data != null, "begin_session avec une sauvegarde nulle")
	save = data
	current_slot = slot
	world_index = data.world_reached
	level_index = data.level_reached
	pocket_power = data.pocket_power
	max_health = BASE_MAX_HEALTH + int(data.upgrades.get(&"max_health", 0))
	health = max_health


func begin_level(world: int, level: int, time_limit: float) -> void:
	world_index = world
	level_index = level
	level_time_limit = time_limit
	level_elapsed = 0.0
	checkpoint_index = -1
	hidden_ambers_found = 0
	level_amber = 0
	health = max_health
	active_power = &""
	is_in_level = true
	EventBus.level_started.emit()


func end_level(stars: int) -> void:
	is_in_level = false
	save.set_star_count(world_index, level_index, stars)
	var key: String = "%d_%d" % [world_index, level_index]
	var previous: float = float(save.level_best_time.get(key, INF))
	if level_elapsed < previous:
		save.level_best_time[key] = level_elapsed
	save.pocket_power = pocket_power
	EventBus.level_completed.emit(stars, level_elapsed)
	EventBus.stars_changed.emit(world_index, level_index, stars)


func _process(delta: float) -> void:
	if is_in_level and not is_paused:
		level_elapsed += delta
		save.play_time_seconds += delta


# --- Sante ------------------------------------------------------------------

## Retire des PV. Retourne true si SORIO est mort.
## Le mode assiste divise les degats par deux (C.10).
func damage(amount: int, cause: StringName = &"unknown") -> bool:
	var applied: int = amount
	if Settings.get_bool(&"accessibility", &"assist_mode"):
		applied = maxi(1, amount / 2)
	health = maxi(0, health - applied)
	EventBus.player_damaged.emit(health, cause)
	if health <= 0:
		EventBus.player_died.emit(cause)
		return true
	return false


func heal(amount: int) -> void:
	health = mini(max_health, health + amount)
	EventBus.player_healed.emit(health)


# --- Economie ---------------------------------------------------------------

func add_amber(amount: int) -> void:
	save.amber += amount
	level_amber += amount
	save.amber_toward_life += amount
	while save.amber_toward_life >= AMBER_PER_LIFE:
		save.amber_toward_life -= AMBER_PER_LIFE
		add_life(1)
	EventBus.amber_changed.emit(save.amber)


## Retourne false si le joueur n'a pas assez d'ambres : l'appelant doit
## verifier, la depense ne passe jamais en negatif.
func spend_amber(amount: int) -> bool:
	if save.amber < amount:
		return false
	save.amber -= amount
	EventBus.amber_changed.emit(save.amber)
	return true


func add_shards(amount: int) -> void:
	save.shards += amount
	EventBus.shards_changed.emit(save.shards)


func add_life(amount: int) -> void:
	save.lives += amount
	EventBus.lives_changed.emit(save.lives)


## Consomme une vie. En mode assiste le compteur reste affiche mais ne
## descend pas (C.10). Retourne false si c'est le game over.
func consume_life() -> bool:
	if Settings.get_bool(&"accessibility", &"assist_mode"):
		return true
	save.lives -= 1
	EventBus.lives_changed.emit(save.lives)
	return save.lives >= 0


# --- Collection -------------------------------------------------------------

func discover_power(id: StringName) -> void:
	if id in save.powers_discovered:
		return
	save.powers_discovered.append(id)
	EventBus.power_discovered.emit(id)


func discover_enemy(id: StringName) -> void:
	if id in save.enemies_discovered:
		return
	save.enemies_discovered.append(id)
	EventBus.enemy_discovered.emit(id)


func count_power_use(id: StringName) -> void:
	save.power_use_counts[id] = int(save.power_use_counts.get(id, 0)) + 1


# --- Etoiles ----------------------------------------------------------------

## Calcule les 3 etoiles du niveau qui vient de se terminer (A.5).
func compute_stars(reached_flag: bool, hidden_total: int) -> int:
	var earned: int = 0
	if reached_flag:
		earned += 1
	if hidden_total > 0 and hidden_ambers_found >= hidden_total:
		earned += 1
	if level_time_limit > 0.0 and level_elapsed <= level_time_limit:
		earned += 1
	return earned


func has_upgrade(id: StringName) -> bool:
	return int(save.upgrades.get(id, 0)) > 0


func upgrade_level(id: StringName) -> int:
	return int(save.upgrades.get(id, 0))
