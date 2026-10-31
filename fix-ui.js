/**
 * fix-ui.js
 * Utilitaire de remplacement de blocs d'interface utilisateur.
 */

/**
 * Remplace un bloc d'UI selon son contenu et son indentation.
 *
 * @param {string} block Le bloc à examiner.
 * @param {Array} result Tableau dans lequel pousser le nouveau bloc.
 * @param {string} newBlock1 Bloc pour la première occurrence (moins indentée).
 * @param {string} newBlock2 Bloc pour les autres occurrences.
 */
function remplacer(block, result, newBlock1, newBlock2) {
    // Remplacer
    if (block.includes("addCommunityIndexerItem") || block.includes("flex: 1")) {
        // Première occurrence (moins indentée)
        if (!block.match(/^ {16}/)) {
            result.push(newBlock1);
        } else {
            result.push(newBlock2);
        }
    }
}

module.exports = { remplacer };
