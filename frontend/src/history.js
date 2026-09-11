export class MoveHistory {
  constructor() {
    this.scrambleMoves = [];
    this.solutionMoves = [];
    this.manualMoves = [];
  }

  clear() {
    this.scrambleMoves = [];
    this.solutionMoves = [];
    this.manualMoves = [];
  }

  setScramble(moves) {
    this.scrambleMoves = [...moves];
  }

  setSolution(moves) {
    this.solutionMoves = [...moves];
  }

  addMove(move) {
    this.manualMoves.push(move);
  }

  getMoves() {
    return [...this.scrambleMoves, ...this.manualMoves];
  }

  getScramble() {
    return [...this.scrambleMoves];
  }

  getSolution() {
    return [...this.solutionMoves];
  }

  format(moves) {
    if (moves.length === 0) return '';
    return moves.join(' ');
  }

  summary() {
    const parts = [];
    if (this.scrambleMoves.length > 0) {
      parts.push(`Scramble: ${this.format(this.scrambleMoves)}`);
    }
    if (this.solutionMoves.length > 0) {
      parts.push(`Solution: ${this.format(this.solutionMoves)}`);
    }
    if (this.manualMoves.length > 0) {
      parts.push(`Manual: ${this.format(this.manualMoves)}`);
    }
    return parts.join('\n');
  }
}

export function invertMoves(moves) {
  const inverse = [];
  for (let i = moves.length - 1; i >= 0; i--) {
    const move = moves[i];
    if (move.includes("'")) {
      inverse.push(move.replace("'", ''));
    } else {
      inverse.push(move + "'");
    }
  }
  return inverse;
}

export function optimizeSolution(moves) {
  if (moves.length === 0) return { moves: [], removed: 0 };

  const result = [];
  let removed = 0;

  for (let i = 0; i < moves.length; i++) {
    const move = moves[i];
    const face = move[0];
    const isPrime = move.includes("'");

    if (result.length === 0) {
      result.push(move);
      continue;
    }

    const last = result[result.length - 1];
    const lastFace = last[0];

    if (face === lastFace) {
      const lastPrime = last.includes("'");
      // Same face: combine
      if (isPrime === lastPrime) {
        // Same direction: R + R = R2
        result[result.length - 1] = face + '2';
        removed++;
      } else {
        // Opposite direction: R + R' = identity
        result.pop();
        removed += 2;
      }
    } else {
      result.push(move);
    }
  }

  return { moves: result, removed };
}
