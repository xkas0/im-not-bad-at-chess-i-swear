import json
import random
import chess
import chess.engine

ENGINE_PATH = r"stockfish\stockfish-windows-x86-64-universal.exe"
HOW_MANY_POSITIONS = 100


def make_position():
    """Play random legal moves to get a random, still-running position."""
    while True:
        board = chess.Board()
        for _ in range(random.randint(10, 30)):
            if board.is_game_over():
                break
            board.push(random.choice(list(board.legal_moves)))
        if not board.is_game_over() and board.legal_moves.count() >= 10:
            return board


def score_moves(engine, board):
    """Ask Stockfish to score every legal move. Returns {move: score}."""
    how_many = board.legal_moves.count()
    results = engine.analyse(board, chess.engine.Limit(time=0.5), multipv=how_many)

    scores = {}
    for result in results:
        move = result["pv"][0]
        scores[move] = result["score"].relative.score(mate_score=10000)
    return scores


engine = chess.engine.SimpleEngine.popen_uci(ENGINE_PATH)
positions = []

for number in range(HOW_MANY_POSITIONS):
    board = make_position()
    scores = score_moves(engine, board)

    moves_as_text = {move.uci(): score for move, score in scores.items()}
    positions.append({"fen": board.fen(), "scores": moves_as_text})

    print(f"Done {number + 1} of {HOW_MANY_POSITIONS}")

engine.quit()

with open("positions.json", "w") as file:
    json.dump(positions, file)

print("Saved positions.json")