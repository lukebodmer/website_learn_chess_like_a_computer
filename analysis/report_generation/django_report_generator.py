from typing import Dict, Any
import json
from html import escape as html_escape


def generate_report_content(analysis_data: Dict[str, Any]) -> str:
    """Generate just the content part of the HTML report (without HTML document structure)"""
    username = analysis_data["username"]
    basic_stats = analysis_data["basic_stats"]
    terminations = analysis_data["terminations"]
    openings = analysis_data["openings"]
    accuracy_analysis = analysis_data.get("accuracy_analysis", {})

    html = f"""
    <!-- Report content - styling handled by main.css -->

    <div class="section report-header">
        <h1>Chess Analysis Report</h1>
        <h2>{username}</h2>
        <p>Comprehensive analysis of your chess games</p>
    </div>

    <div class="section">
        <h2>📊 Game Overview</h2>
        <div class="stats-grid">
            <div class="stat-card">
                <div class="stat-number">{basic_stats['total_games']}</div>
                <div class="stat-label">Total Games</div>
            </div>
            <div class="stat-card">
                <div class="stat-number">{basic_stats['white_games']}</div>
                <div class="stat-label">Games as White</div>
            </div>
            <div class="stat-card">
                <div class="stat-number">{basic_stats['black_games']}</div>
                <div class="stat-label">Games as Black</div>
            </div>
        </div>
    </div>

    <div class="section">
        <h2>⚡ Game Terminations</h2>
        <p>How your games end and your success rate in each scenario:</p>

        <div class="terminations-charts">
            <div class="chart-container">
                <h4>How I Win as White</h4>
                <canvas id="whiteWins" width="300" height="300"></canvas>
            </div>
            <div class="chart-container">
                <h4>How I Lose as White</h4>
                <canvas id="whiteLosses" width="300" height="300"></canvas>
            </div>
            <div class="chart-container">
                <h4>How I Win as Black</h4>
                <canvas id="blackWins" width="300" height="300"></canvas>
            </div>
            <div class="chart-container">
                <h4>How I Lose as Black</h4>
                <canvas id="blackLosses" width="300" height="300"></canvas>
            </div>
        </div>

        <script type="application/json" id="terminationsData">
{json.dumps({
    "whiteWins": {term: stats.get('white_wins', 0) for term, stats in terminations.items()},
    "whiteLosses": {term: stats.get('white_losses', 0) for term, stats in terminations.items()},
    "blackWins": {term: stats.get('black_wins', 0) for term, stats in terminations.items()},
    "blackLosses": {term: stats.get('black_losses', 0) for term, stats in terminations.items()}
}, indent=2)}
        </script>
    </div>
    """

    # Calculate total games in opening analysis
    total_opening_games = sum(stats["total"] for stats in openings.values())

    html += f"""
    <div class="section">
        <h2>♞ Opening Analysis</h2>
        <p>Your opening repertoire and success rates:</p>
        <p><strong>Total games in opening analysis: {total_opening_games}</strong></p>
        <table>
            <thead>
                <tr>
                    <th>Opening</th>
                    <th>Games</th>
                    <th>Results</th>
                    <th>Success Rate</th>
                    <th>Board</th>
                </tr>
            </thead>
            <tbody>
"""

    # Add opening statistics (show top 4, then collapsible "show more")
    opening_id = 0
    opening_list = list(openings.items())
    top_openings = opening_list[:4]
    additional_openings = opening_list[4:]

    # Show top 5 openings
    for main_opening, stats in top_openings:
        opening_id += 1
        win_rate = stats.get("win_rate", 0)
        success_rate = stats.get("success_rate", 0)
        variations = stats.get("variations", {})
        variation_count = len(variations)

        # Color code success rates
        success_class = (
            "success-good"
            if success_rate >= 60
            else "success-ok" if success_rate >= 45 else "success-poor"
        )

        # Clean opening name for use as CSS class/ID
        clean_opening_name = main_opening.replace(" ", "_").replace("'", "").replace(",", "").replace(":", "").replace("-", "_")

        # Get data and calculate percentages for bar chart
        wins = stats['wins']
        draws = stats['draws']
        losses = stats['losses']
        total_games = stats['total']

        # Calculate percentages ensuring they total exactly 100%
        if total_games > 0:
            # Calculate exact percentages
            win_pct = (wins / total_games) * 100
            draw_pct = (draws / total_games) * 100

            # Force the last percentage to fill remaining space to avoid gaps
            loss_pct = 100 - win_pct - draw_pct

            # Ensure no negative percentages
            win_pct = max(0, win_pct)
            draw_pct = max(0, draw_pct)
            loss_pct = max(0, loss_pct)
        else:
            win_pct = draw_pct = loss_pct = 0

        # Main opening row (clickable)
        html += f"""
                <tr class="opening-row" onclick="toggleVariations('variations-{opening_id}')">
                    <td>
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <span><strong>{main_opening}</strong> {f'({variation_count} variations)' if variation_count > 1 else ''}</span>
                            <button onclick="event.stopPropagation(); window.loadBuddyBoardByOpening && window.loadBuddyBoardByOpening('{main_opening.replace("'", "\\'")}')"
                                    class="buddy-load-btn" title="Load games in Buddy Board">♞</button>
                        </div>
                    </td>
                    <td><strong>{stats['total']}</strong></td>
                    <td class="results-bar-cell">
                        <div class="results-bar-container">
                            <div class="results-bar-simple" style="width: 150px; height: 16px;">
                                <div class="bar-win" style="width: {win_pct}%; background: #28a745;" title="Wins: {wins}"></div>
                                <div class="bar-draw" style="width: {draw_pct}%; background: #fd7e14;" title="Draws: {draws}"></div>
                                <div class="bar-loss" style="width: {loss_pct}%; background: #dc3545;" title="Losses: {losses}"></div>
                            </div>
                            <div class="results-text">{wins}W {draws}D {losses}L</div>
                        </div>
                    </td>
                    <td class="success-rate {success_class}"><strong>{success_rate}%</strong></td>
                    <td class="chess-board-cell">
                        <div class="chess-board-container">
                            <div id="board-{clean_opening_name}-{opening_id}" class="chess-board-small" data-opening="{main_opening}"></div>
                            <div class="board-controls">
                                <button onclick="event.stopPropagation(); previousMove('board-{clean_opening_name}-{opening_id}')" class="board-btn">←</button>
                                <button onclick="event.stopPropagation(); nextMove('board-{clean_opening_name}-{opening_id}')" class="board-btn">→</button>
                                <button onclick="event.stopPropagation(); resetBoard('board-{clean_opening_name}-{opening_id}')" class="board-btn">↺</button>
                            </div>
                        </div>
                    </td>
                </tr>"""

        # Variation dropdown (collapsible)
        if variation_count > 1:  # Only show variations if there's more than one
            # Store variation data as JSON for JavaScript access
            variation_data = {}
            for variation, var_stats in variations.items():
                variation_data[variation] = {
                    'wins': var_stats['wins'],
                    'draws': var_stats['draws'],
                    'losses': var_stats['losses'],
                    'total': var_stats['total'],
                    'success_rate': var_stats.get('success_rate', 0)
                }

            variation_data_json = html_escape(json.dumps(variation_data))

            html += f"""
                <tr id="variations-{opening_id}" class="variations-row">
                    <td colspan="5">
                        <div class="variant-selector-container">
                            <div class="variant-options" data-opening-id="{opening_id}"
                                 data-board-id="board-{clean_opening_name}-{opening_id}"
                                 data-variations='{variation_data_json}'>
                                <div class="variant-option active" data-variant="{main_opening}" onclick="selectVariant(this)">
                                    <span class="variant-label">All Variations Combined</span>
                                    <div class="variant-chart">
                                        <div class="variant-bar" style="width: 80px; height: 8px;">
                                            <div class="bar-win" style="width: {win_pct}%; background: #28a745;" title="Wins: {wins}"></div>
                                            <div class="bar-draw" style="width: {draw_pct}%; background: #fd7e14;" title="Draws: {draws}"></div>
                                            <div class="bar-loss" style="width: {loss_pct}%; background: #dc3545;" title="Losses: {losses}"></div>
                                        </div>
                                    </div>
                                </div>"""

            for variation in variations.keys():
                # Escape quotes in variation names for data attribute
                escaped_variation = variation.replace('"', '&quot;').replace("'", "&#39;")
                var_stats = variations[variation]
                var_wins = var_stats['wins']
                var_draws = var_stats['draws']
                var_losses = var_stats['losses']
                var_total = var_stats['total']

                # Calculate percentages ensuring they total exactly 100%
                if var_total > 0:
                    # Calculate exact percentages
                    var_win_pct = (var_wins / var_total) * 100
                    var_draw_pct = (var_draws / var_total) * 100

                    # Force the last percentage to fill remaining space to avoid gaps
                    var_loss_pct = 100 - var_win_pct - var_draw_pct

                    # Ensure no negative percentages
                    var_win_pct = max(0, var_win_pct)
                    var_draw_pct = max(0, var_draw_pct)
                    var_loss_pct = max(0, var_loss_pct)
                else:
                    var_win_pct = var_draw_pct = var_loss_pct = 0

                html += f"""
                                <div class="variant-option" data-variant="{escaped_variation}" onclick="selectVariant(this)">
                                    <span class="variant-label">{variation}</span>
                                    <div class="variant-chart">
                                        <div class="variant-bar" style="width: 80px; height: 8px;">
                                            <div class="bar-win" style="width: {var_win_pct}%; background: #28a745;" title="Wins: {var_wins}"></div>
                                            <div class="bar-draw" style="width: {var_draw_pct}%; background: #fd7e14;" title="Draws: {var_draws}"></div>
                                            <div class="bar-loss" style="width: {var_loss_pct}%; background: #dc3545;" title="Losses: {var_losses}"></div>
                                        </div>
                                    </div>
                                </div>"""

            html += """
                            </div>
                        </div>
                    </td>
                </tr>"""

    # Add "Show More" row if there are additional openings
    if additional_openings:
        html += f"""
                <tr class="show-more-row">
                    <td colspan="5"><strong>Show {len(additional_openings)} more openings...</strong></td>
                </tr>"""

        # Additional openings (initially hidden)
        for main_opening, stats in additional_openings:
            opening_id += 1
            win_rate = stats.get("win_rate", 0)
            success_rate = stats.get("success_rate", 0)
            variations = stats.get("variations", {})
            variation_count = len(variations)

            # Color code success rates
            success_class = (
                "success-good"
                if success_rate >= 60
                else "success-ok" if success_rate >= 45 else "success-poor"
            )

            # Clean opening name for use as CSS class/ID
            clean_opening_name = main_opening.replace(" ", "_").replace("'", "").replace(",", "").replace(":", "").replace("-", "_")

            # Get data and calculate percentages for bar chart
            wins = stats['wins']
            draws = stats['draws']
            losses = stats['losses']
            total_games = stats['total']

            # Calculate percentages ensuring they total exactly 100%
            if total_games > 0:
                # Calculate exact percentages
                win_pct = (wins / total_games) * 100
                draw_pct = (draws / total_games) * 100

                # Force the last percentage to fill remaining space to avoid gaps
                loss_pct = 100 - win_pct - draw_pct

                # Ensure no negative percentages
                win_pct = max(0, win_pct)
                draw_pct = max(0, draw_pct)
                loss_pct = max(0, loss_pct)
            else:
                win_pct = draw_pct = loss_pct = 0

            # Main opening row (clickable)
            html += f"""
                    <tr class="opening-row additional-openings" onclick="toggleVariations('variations-{opening_id}')">
                        <td>
                            <div style="display: flex; justify-content: space-between; align-items: center;">
                                <span><strong>{main_opening}</strong> {f'({variation_count} variations)' if variation_count > 1 else ''}</span>
                                <button onclick="event.stopPropagation(); window.loadBuddyBoardByOpening && window.loadBuddyBoardByOpening('{main_opening.replace("'", "\\'")}')"
                                        class="buddy-load-btn" title="Load games in Buddy Board">♞</button>
                            </div>
                        </td>
                        <td><strong>{stats['total']}</strong></td>
                        <td class="results-bar-cell">
                            <div class="results-bar-container">
                                <div class="results-bar-simple" style="width: 150px; height: 16px;">
                                    <div class="bar-win" style="width: {win_pct}%; background: #28a745;" title="Wins: {wins}"></div>
                                    <div class="bar-draw" style="width: {draw_pct}%; background: #fd7e14;" title="Draws: {draws}"></div>
                                    <div class="bar-loss" style="width: {loss_pct}%; background: #dc3545;" title="Losses: {losses}"></div>
                                </div>
                                <div class="results-text">{wins}W {draws}D {losses}L</div>
                            </div>
                        </td>
                        <td class="success-rate {success_class}"><strong>{success_rate}%</strong></td>
                        <td class="chess-board-cell">
                            <div class="chess-board-container">
                                <div id="board-{clean_opening_name}-{opening_id}" class="chess-board-small" data-opening="{main_opening}"></div>
                                <div class="board-controls">
                                    <button onclick="event.stopPropagation(); previousMove('board-{clean_opening_name}-{opening_id}')" class="board-btn">←</button>
                                    <button onclick="event.stopPropagation(); nextMove('board-{clean_opening_name}-{opening_id}')" class="board-btn">→</button>
                                    <button onclick="event.stopPropagation(); resetBoard('board-{clean_opening_name}-{opening_id}')" class="board-btn">↺</button>
                                </div>
                            </div>
                        </td>
                    </tr>"""

            # Variation dropdown (collapsible)
            if variation_count > 1:  # Only show variations if there's more than one
                # Store variation data as JSON for JavaScript access
                variation_data = {}
                for variation, var_stats in variations.items():
                    variation_data[variation] = {
                        'wins': var_stats['wins'],
                        'draws': var_stats['draws'],
                        'losses': var_stats['losses'],
                        'total': var_stats['total'],
                        'success_rate': var_stats.get('success_rate', 0)
                    }

                variation_data_json = html_escape(json.dumps(variation_data))

                html += f"""
                    <tr id="variations-{opening_id}" class="variations-row additional-openings">
                        <td colspan="5">
                            <div class="variant-selector-container">
                                <div class="variant-options" data-opening-id="{opening_id}"
                                     data-board-id="board-{clean_opening_name}-{opening_id}"
                                     data-variations='{variation_data_json}'>
                                    <div class="variant-option active" data-variant="{main_opening}" onclick="selectVariant(this)">
                                        <span class="variant-label">All Variations Combined</span>
                                        <div class="variant-chart">
                                            <div class="variant-bar" style="width: 80px; height: 8px;">
                                                <div class="bar-win" style="width: {win_pct}%; background: #28a745;" title="Wins: {wins}"></div>
                                                <div class="bar-draw" style="width: {draw_pct}%; background: #fd7e14;" title="Draws: {draws}"></div>
                                                <div class="bar-loss" style="width: {loss_pct}%; background: #dc3545;" title="Losses: {losses}"></div>
                                            </div>
                                        </div>
                                    </div>"""

                for variation in variations.keys():
                    # Escape quotes in variation names for data attribute
                    escaped_variation = variation.replace('"', '&quot;').replace("'", "&#39;")
                    var_stats = variations[variation]
                    var_wins = var_stats['wins']
                    var_draws = var_stats['draws']
                    var_losses = var_stats['losses']
                    var_total = var_stats['total']

                    # Calculate percentages ensuring they total exactly 100%
                    if var_total > 0:
                        # Calculate exact percentages
                        var_win_pct = (var_wins / var_total) * 100
                        var_draw_pct = (var_draws / var_total) * 100

                        # Force the last percentage to fill remaining space to avoid gaps
                        var_loss_pct = 100 - var_win_pct - var_draw_pct

                        # Ensure no negative percentages
                        var_win_pct = max(0, var_win_pct)
                        var_draw_pct = max(0, var_draw_pct)
                        var_loss_pct = max(0, var_loss_pct)
                    else:
                        var_win_pct = var_draw_pct = var_loss_pct = 0

                    html += f"""
                                    <div class="variant-option" data-variant="{escaped_variation}" onclick="selectVariant(this)">
                                        <span class="variant-label">{variation}</span>
                                        <div class="variant-chart">
                                            <div class="variant-bar" style="width: 80px; height: 8px;">
                                                <div class="bar-win" style="width: {var_win_pct}%; background: #28a745;" title="Wins: {var_wins}"></div>
                                                <div class="bar-draw" style="width: {var_draw_pct}%; background: #fd7e14;" title="Draws: {var_draws}"></div>
                                                <div class="bar-loss" style="width: {var_loss_pct}%; background: #dc3545;" title="Losses: {var_losses}"></div>
                                            </div>
                                        </div>
                                    </div>"""

                html += """
                                </div>
                            </div>
                        </td>
                    </tr>"""

        # Add "Show Fewer" row at the end of additional openings (initially hidden)
        html += f"""
                <tr class="show-fewer-row additional-openings" style="display: none;">
                    <td colspan="5"><strong>Show fewer openings...</strong></td>
                </tr>"""

    html += """
            </tbody>
        </table>
        <p><small><strong>Note:</strong> Success rate = (Wins + 0.5 × Draws) ÷ Total Games × 100%</small></p>
    </div>
"""

    # Add accuracy analysis section if data is available
    if accuracy_analysis and accuracy_analysis.get("total_games_with_analysis", 0) > 0:
        total_analyzed = accuracy_analysis["total_games_with_analysis"]
        avg_accuracy = accuracy_analysis["average_accuracy"]
        best_accuracy = accuracy_analysis["best_accuracy"]
        worst_accuracy = accuracy_analysis["worst_accuracy"]

        html += f"""
    <div class="section">
        <h2>🎯 Accuracy Analysis</h2>
        <p>Analysis based on {total_analyzed} games with computer analysis:</p>

        <div class="stats-grid">
            <div class="stat-card">
                <div class="stat-number">{avg_accuracy}%</div>
                <div class="stat-label">Average Accuracy</div>
            </div>
            <div class="stat-card">
                <div class="stat-number">{best_accuracy}%</div>
                <div class="stat-label">Best Game Accuracy</div>
            </div>
            <div class="stat-card">
                <div class="stat-number">{worst_accuracy}%</div>
                <div class="stat-label">Worst Game Accuracy</div>
            </div>
        </div>

        <h3>Accuracy by Color</h3>
        <table>
            <thead>
                <tr>
                    <th>Playing As</th>
                    <th>Games Analyzed</th>
                    <th>Average Accuracy</th>
                    <th>Best</th>
                    <th>Worst</th>
                </tr>
            </thead>
            <tbody>
                <tr>
                    <td>White</td>
                    <td>{accuracy_analysis['accuracy_by_color']['white']['games']}</td>
                    <td>{accuracy_analysis['accuracy_by_color']['white']['average']}%</td>
                    <td>{accuracy_analysis['accuracy_by_color']['white']['best']}%</td>
                    <td>{accuracy_analysis['accuracy_by_color']['white']['worst']}%</td>
                </tr>
                <tr>
                    <td>Black</td>
                    <td>{accuracy_analysis['accuracy_by_color']['black']['games']}</td>
                    <td>{accuracy_analysis['accuracy_by_color']['black']['average']}%</td>
                    <td>{accuracy_analysis['accuracy_by_color']['black']['best']}%</td>
                    <td>{accuracy_analysis['accuracy_by_color']['black']['worst']}%</td>
                </tr>
            </tbody>
        </table>

        <h3>Accuracy Distribution</h3>
        <table>
            <thead>
                <tr>
                    <th>Accuracy Range</th>
                    <th>Games</th>
                    <th>Percentage</th>
                </tr>
            </thead>
            <tbody>
"""

        # Add accuracy distribution rows
        accuracy_ranges = [
            ("90-100%", "90_100", "Excellent"),
            ("80-89%", "80_89", "Good"),
            ("70-79%", "70_79", "Average"),
            ("60-69%", "60_69", "Poor"),
            ("Below 60%", "below_60", "Very Poor"),
        ]

        for range_name, range_key, quality in accuracy_ranges:
            dist_data = accuracy_analysis["accuracy_distribution"].get(
                range_key, {"count": 0, "percentage": 0}
            )
            count = dist_data["count"]
            percentage = dist_data["percentage"]

            html += f"""
                <tr>
                    <td>{range_name} ({quality})</td>
                    <td>{count}</td>
                    <td>{percentage}%</td>
                </tr>"""

        html += """
            </tbody>
        </table>
    </div>
"""

    html += """
    <div class="section">
        <h2>🎯 Key Insights</h2>
        <ul>
"""

    # Generate some insights
    if basic_stats["white_games"] > basic_stats["black_games"]:
        html += f"<li>You play White more often ({basic_stats['white_games']} vs {basic_stats['black_games']} games)</li>"
    elif basic_stats["black_games"] > basic_stats["white_games"]:
        html += f"<li>You play Black more often ({basic_stats['black_games']} vs {basic_stats['white_games']} games)</li>"
    else:
        html += "<li>You have a balanced distribution of White and Black games</li>"

    # Most common termination
    if terminations:
        most_common_term = max(terminations.items(), key=lambda x: x[1]["total"])
        html += f"<li>Most common game ending: {most_common_term[0]} ({most_common_term[1]['total']} games)</li>"

    # Best performing opening
    if openings:
        best_opening = max(
            [(k, v) for k, v in openings.items() if v["total"] >= 3],
            key=lambda x: x[1]["success_rate"],
            default=None,
        )
        if best_opening:
            html += f"<li>Best performing opening (3+ games): {best_opening[0]} ({best_opening[1]['success_rate']}% success rate)</li>"

    # Most played opening
    if openings:
        most_played = max(openings.items(), key=lambda x: x[1]["total"])
        html += f"<li>Most frequently played opening: {most_played[0]} ({most_played[1]['total']} games)</li>"

    html += """
        </ul>
    </div>

    <div class="report-footer">
        <p>Generated by <strong>Learn Chess Like a Computer</strong></p>
        <p><small>This analysis is based on your game data and provides insights to help improve your chess performance.</small></p>
    </div>

    <!-- JavaScript functionality handled by external report.js -->
"""

    return html
