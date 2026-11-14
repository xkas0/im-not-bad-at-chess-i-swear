# makes positions.json: random positions + a stockfish score for every legal move
# py magic_generator.py = 2000 positions, py magic_generator.py 50 = quick test
# ctrl+c is fine, it saves what it has
import json
import random
import sys
from collections import Counter

import chess
import chess.engine

ENGINE_PATH = r"stockfish\stockfish-windows-x86-64-universal.exe"
HOW_MANY_POSITIONS = int(sys.argv[1]) if len(sys.argv) > 1 else 2000
SECONDS_PER_POSITION = 0.5
THREADS = 4                  # more threads = faster. lower it if your pc starts crying
SAVE_EVERY = 100
OUTPUT_FILE = "positions.json"

# what counts as boring, change these if games feel too easy or too weird
MAX_EQUALLY_WORST = 3        # if more moves than this tie for worst, finding "the" worst move is a coin flip
MIN_SPREAD = 150             # worst move must lose at least 1.5 pawns compared to the best one
ALREADY_DECIDED = 800        # skip positions where somebody is already totally winning

PIECE_VALUES = {chess.PAWN: 1, chess.KNIGHT: 3, chess.BISHOP: 3, chess.ROOK: 5, chess.QUEEN: 9, chess.KING: 99}


def make_position():
    while True:
        roll = random.random()
        if roll < 0.35:
            how_many_moves = random.randint(10, 24)
        elif roll < 0.8:
            how_many_moves = random.randint(25, 45)
        else:
            how_many_moves = random.randint(46, 80)

        board = chess.Board()
        for _ in range(how_many_moves):
            if board.is_game_over():
                break
            board.push(random.choice(list(board.legal_moves)))

        if board.is_game_over() or board.is_check():
            continue
        if board.legal_moves.count() >= 10:
            return board


def score_moves(engine, board):
    # returns the scores and the opponent's best reply to each move (for the punishment animation)
    how_many = board.legal_moves.count()
    results = engine.analyse(board, chess.engine.Limit(time=SECONDS_PER_POSITION), multipv=how_many)

    scores = {}
    replies = {}
    for result in results:
        line = result["pv"]
        move = line[0]
        scores[move] = result["score"].relative.score(mate_score=10000)
        if len(line) > 1:                  # (no reply if the move ends the game)
            replies[move] = line[1]
    return scores, replies


def hangs_the_queen(board, move):
    board.push(move)
    mover = not board.turn            # the side that just moved
    hung = False
    for square in board.pieces(chess.QUEEN, mover):
        attackers = board.attackers(board.turn, square)
        if not attackers:
            continue
        cheapest = min(PIECE_VALUES[board.piece_type_at(a)] for a in attackers)
        defended = bool(board.attackers(mover, square))
        if cheapest < PIECE_VALUES[chess.QUEEN] or not defended:
            hung = True
    board.pop()
    return hung


def why_boring(board, scores):
    best = max(scores.values())
    worst = min(scores.values())
    worst_moves = [m for m, s in scores.items() if s == worst]

    if abs(best) > ALREADY_DECIDED:
        return "game already decided"
    if len(worst_moves) > MAX_EQUALLY_WORST:
        return "too many equally bad moves"
    if best - worst < MIN_SPREAD:
        return "no real blunders available"
    if any(hangs_the_queen(board, m) for m in worst_moves):
        return "worst move just hangs the queen"
    return None


def save(positions):
    shuffled = positions[:]
    random.shuffle(shuffled)          # so the file isn't in the order they were made
    with open(OUTPUT_FILE, "w") as file:
        json.dump(shuffled, file, separators=(",", ":"))


engine = chess.engine.SimpleEngine.popen_uci(ENGINE_PATH)
engine.configure({"Threads": THREADS})

positions = []
seen = set()                 # board layouts we already have (no repeats!)
skipped = Counter()

try:
    while len(positions) < HOW_MANY_POSITIONS:
        board = make_position()

        # first 4 parts of the fen, the move counters don't matter
        layout = " ".join(board.fen().split()[:4])
        if layout in seen:
            skipped["repeat"] += 1
            continue
        seen.add(layout)

        scores, replies = score_moves(engine, board)
        reason = why_boring(board, scores)
        if reason:
            skipped[reason] += 1
            continue

        moves_as_text = {move.uci(): score for move, score in scores.items()}
        replies_as_text = {move.uci(): reply.uci() for move, reply in replies.items()}
        positions.append({"fen": board.fen(), "scores": moves_as_text, "replies": replies_as_text})
        print(f"Done {len(positions)} of {HOW_MANY_POSITIONS}   (skipped {sum(skipped.values())} so far)")

        if len(positions) % SAVE_EVERY == 0:
            save(positions)
except KeyboardInterrupt:
    print("\nStopped early, saving what we have...")
finally:
    engine.quit()

save(positions)
print(f"Saved {len(positions)} positions to {OUTPUT_FILE}")
print("Skipped:", dict(skipped))