class_name TestCase
extends RefCounted
## Classe de base des tests unitaires de SORIO.
##
## Runner maison plutot que GUT : l'addon n'est pas recuperable dans
## l'environnement de construction (acces reseau restreint), et la regle D.7
## interdit d'ajouter un autre addon externe sans accord. Ce fichier plus
## `src/tools/run_tests.gd` font le travail en ~200 lignes, sans dependance.
##
## Convention : un fichier `tests/*_test.gd` qui etend `TestCase`. Chaque
## methode `test_*` est un cas. `before_each` / `after_each` sont optionnels.

## Echecs du cas en cours, remplis par les assertions.
var failures: PackedStringArray = PackedStringArray()
## Nombre d'assertions executees, pour reperer un test qui n'assure rien.
var assertion_count: int = 0

## Arbre de scenes, injecte par le runner pour les tests qui instancient
## des noeuds. Nul dans un test purement logique.
var tree: SceneTree = null


func before_each() -> void:
	pass


func after_each() -> void:
	pass


# --- Assertions -------------------------------------------------------------

func assert_true(value: bool, message: String = "") -> void:
	assertion_count += 1
	if not value:
		_fail("attendu vrai, obtenu faux", message)


func assert_false(value: bool, message: String = "") -> void:
	assertion_count += 1
	if value:
		_fail("attendu faux, obtenu vrai", message)


func assert_eq(actual: Variant, expected: Variant, message: String = "") -> void:
	assertion_count += 1
	if actual != expected:
		_fail("attendu %s, obtenu %s" % [str(expected), str(actual)], message)


func assert_ne(actual: Variant, unexpected: Variant, message: String = "") -> void:
	assertion_count += 1
	if actual == unexpected:
		_fail("valeur interdite obtenue : %s" % str(actual), message)


## Comparaison de flottants : indispensable pour la physique (B.4).
func assert_almost_eq(
	actual: float, expected: float, tolerance: float = 0.001, message: String = ""
) -> void:
	assertion_count += 1
	if absf(actual - expected) > tolerance:
		_fail(
			"attendu %f +/- %f, obtenu %f" % [expected, tolerance, actual], message
		)


func assert_gt(actual: float, threshold: float, message: String = "") -> void:
	assertion_count += 1
	if actual <= threshold:
		_fail("attendu > %f, obtenu %f" % [threshold, actual], message)


func assert_lt(actual: float, threshold: float, message: String = "") -> void:
	assertion_count += 1
	if actual >= threshold:
		_fail("attendu < %f, obtenu %f" % [threshold, actual], message)


func assert_between(
	actual: float, low: float, high: float, message: String = ""
) -> void:
	assertion_count += 1
	if actual < low or actual > high:
		_fail("attendu entre %f et %f, obtenu %f" % [low, high, actual], message)


func assert_null(value: Variant, message: String = "") -> void:
	assertion_count += 1
	if value != null:
		_fail("attendu null, obtenu %s" % str(value), message)


func assert_not_null(value: Variant, message: String = "") -> void:
	assertion_count += 1
	if value == null:
		_fail("attendu non-null", message)


func assert_has(collection: Variant, element: Variant, message: String = "") -> void:
	assertion_count += 1
	var found: bool = false
	if collection is Dictionary:
		found = (collection as Dictionary).has(element)
	elif collection is Array:
		found = (collection as Array).has(element)
	if not found:
		_fail("element absent : %s" % str(element), message)


## Echec explicite, pour les branches qui ne devraient jamais etre atteintes.
func fail(message: String) -> void:
	assertion_count += 1
	_fail("echec explicite", message)


func _fail(detail: String, message: String) -> void:
	var text: String = detail
	if not message.is_empty():
		text = "%s (%s)" % [message, detail]
	failures.append(text)
