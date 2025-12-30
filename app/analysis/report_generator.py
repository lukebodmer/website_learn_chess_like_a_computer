from typing import Dict, Any


def generate_html_report(analysis_data: Dict[str, Any]) -> str:
    """Generate HTML report from analysis data"""
    username = analysis_data['username']
    basic_stats = analysis_data['basic_stats']
    terminations = analysis_data['terminations']
    openings = analysis_data['openings']

    html = f"""
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Chess Analysis Report - {username}</title>
    <style>
        body {{
            font-family: Arial, sans-serif;
            max-width: 1200px;
            margin: 0 auto;
            padding: 20px;
            background-color: #f5f5f5;
        }}
        .header {{
            text-align: center;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 30px;
            border-radius: 10px;
            margin-bottom: 30px;
        }}
        .section {{
            background: white;
            padding: 20px;
            margin-bottom: 20px;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }}
        .section h2 {{
            color: #333;
            border-bottom: 2px solid #667eea;
            padding-bottom: 10px;
        }}
        .stats-grid {{
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 20px;
            margin-bottom: 20px;
        }}
        .stat-card {{
            text-align: center;
            padding: 20px;
            background: #f8f9fa;
            border-radius: 8px;
            border-left: 4px solid #667eea;
        }}
        .stat-number {{
            font-size: 2em;
            font-weight: bold;
            color: #667eea;
        }}
        .stat-label {{
            color: #666;
            font-size: 0.9em;
        }}
        table {{
            width: 100%;
            border-collapse: collapse;
            margin-top: 15px;
        }}
        th, td {{
            padding: 12px;
            text-align: left;
            border-bottom: 1px solid #ddd;
        }}
        th {{
            background-color: #f8f9fa;
            font-weight: bold;
            color: #333;
        }}
        tr:hover {{
            background-color: #f5f5f5;
        }}
        .success-rate {{
            font-weight: bold;
        }}
        .success-good {{ color: #28a745; }}
        .success-ok {{ color: #ffc107; }}
        .success-poor {{ color: #dc3545; }}
        .opening-row {{
            cursor: pointer;
            background-color: #f8f9fa;
        }}
        .opening-row:hover {{
            background-color: #e9ecef;
        }}
        .variations-row {{
            display: none;
            background-color: #fff;
        }}
        .variation-table {{
            margin: 0;
            width: 100%;
        }}
        .variation-table td {{
            padding: 8px 12px;
            border: none;
            font-size: 0.9em;
        }}
        .variation-name {{
            padding-left: 30px;
            font-style: italic;
            color: #666;
        }}
        .show-more-row {{
            text-align: center;
            background-color: #e9ecef;
            cursor: pointer;
        }}
        .show-more-row:hover {{
            background-color: #dee2e6;
        }}
        .additional-openings {{
            display: none;
        }}
    </style>
</head>
<body>
    <div class="header">
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
        <table>
            <thead>
                <tr>
                    <th>Termination Type</th>
                    <th>Total Games</th>
                    <th>Wins</th>
                    <th>Draws</th>
                    <th>Losses</th>
                    <th>Win Rate</th>
                    <th>Success Rate</th>
                </tr>
            </thead>
            <tbody>
"""

    # Add termination statistics with win/loss breakdown (sorted by total games)
    sorted_terminations = sorted(terminations.items(), key=lambda x: x[1]['total'], reverse=True)
    for termination, stats in sorted_terminations:
        win_rate = stats.get('win_rate', 0)
        draw_rate = stats.get('draw_rate', 0)
        loss_rate = stats.get('loss_rate', 0)

        # Calculate success rate (wins + 0.5 * draws)
        success_rate = round(win_rate + (draw_rate * 0.5), 1)

        # Color code success rates
        success_class = 'success-good' if success_rate >= 60 else 'success-ok' if success_rate >= 45 else 'success-poor'

        html += f"""
                <tr>
                    <td>{termination}</td>
                    <td>{stats['total']}</td>
                    <td>{stats['wins']}</td>
                    <td>{stats['draws']}</td>
                    <td>{stats['losses']}</td>
                    <td>{win_rate}%</td>
                    <td class="success-rate {success_class}">{success_rate}%</td>
                </tr>"""

    html += """
            </tbody>
        </table>
    </div>
"""

    # Calculate total games in opening analysis
    total_opening_games = sum(stats['total'] for stats in openings.values())

    html += f"""
    <div class="section">
        <h2>Opening Analysis</h2>
        <p>Your opening repertoire and success rates:</p>
        <p><strong>Total games in opening analysis: {total_opening_games}</strong></p>
        <table>
            <thead>
                <tr>
                    <th>Opening</th>
                    <th>Games Played</th>
                    <th>Wins</th>
                    <th>Draws</th>
                    <th>Losses</th>
                    <th>Win Rate</th>
                    <th>Success Rate</th>
                </tr>
            </thead>
            <tbody>
"""

    # Add opening statistics (show top 15, then collapsible "show more")
    opening_id = 0
    opening_list = list(openings.items())
    top_openings = opening_list[:15]
    additional_openings = opening_list[15:]

    # Show top 15 openings
    for main_opening, stats in top_openings:
        opening_id += 1
        win_rate = stats.get('win_rate', 0)
        success_rate = stats.get('success_rate', 0)
        variations = stats.get('variations', {})
        variation_count = len(variations)

        # Color code success rates
        success_class = 'success-good' if success_rate >= 60 else 'success-ok' if success_rate >= 45 else 'success-poor'

        # Main opening row (clickable)
        html += f"""
                <tr class="opening-row" onclick="toggleVariations('variations-{opening_id}')">
                    <td><strong>{main_opening}</strong> {f'({variation_count} variations)' if variation_count > 1 else ''}</td>
                    <td><strong>{stats['total']}</strong></td>
                    <td>{stats['wins']}</td>
                    <td>{stats['draws']}</td>
                    <td>{stats['losses']}</td>
                    <td>{win_rate}%</td>
                    <td class="success-rate {success_class}"><strong>{success_rate}%</strong></td>
                </tr>"""

        # Variations rows (collapsible)
        if variation_count > 1:  # Only show variations if there's more than one
            html += f"""
                <tr id="variations-{opening_id}" class="variations-row">
                    <td colspan="7">
                        <table class="variation-table">"""

            for variation, var_stats in variations.items():
                var_win_rate = var_stats.get('win_rate', 0)
                var_success_rate = var_stats.get('success_rate', 0)
                var_success_class = 'success-good' if var_success_rate >= 60 else 'success-ok' if var_success_rate >= 45 else 'success-poor'

                html += f"""
                            <tr>
                                <td class="variation-name">{variation}</td>
                                <td>{var_stats['total']}</td>
                                <td>{var_stats['wins']}</td>
                                <td>{var_stats['draws']}</td>
                                <td>{var_stats['losses']}</td>
                                <td>{var_win_rate}%</td>
                                <td class="success-rate {var_success_class}">{var_success_rate}%</td>
                            </tr>"""

            html += """
                        </table>
                    </td>
                </tr>"""

    # Add "Show More" row if there are additional openings
    if additional_openings:
        html += f"""
                <tr class="show-more-row" onclick="toggleAdditionalOpenings()">
                    <td colspan="7"><strong>Show {len(additional_openings)} more openings...</strong></td>
                </tr>"""

        # Additional openings (initially hidden)
        for main_opening, stats in additional_openings:
            opening_id += 1
            win_rate = stats.get('win_rate', 0)
            success_rate = stats.get('success_rate', 0)
            variations = stats.get('variations', {})
            variation_count = len(variations)

            # Color code success rates
            success_class = 'success-good' if success_rate >= 60 else 'success-ok' if success_rate >= 45 else 'success-poor'

            # Main opening row (clickable)
            html += f"""
                    <tr class="opening-row additional-openings" onclick="toggleVariations('variations-{opening_id}')">
                        <td><strong>{main_opening}</strong> {f'({variation_count} variations)' if variation_count > 1 else ''}</td>
                        <td><strong>{stats['total']}</strong></td>
                        <td>{stats['wins']}</td>
                        <td>{stats['draws']}</td>
                        <td>{stats['losses']}</td>
                        <td>{win_rate}%</td>
                        <td class="success-rate {success_class}"><strong>{success_rate}%</strong></td>
                    </tr>"""

            # Variations rows (collapsible)
            if variation_count > 1:  # Only show variations if there's more than one
                html += f"""
                    <tr id="variations-{opening_id}" class="variations-row additional-openings">
                        <td colspan="7">
                            <table class="variation-table">"""

                for variation, var_stats in variations.items():
                    var_win_rate = var_stats.get('win_rate', 0)
                    var_success_rate = var_stats.get('success_rate', 0)
                    var_success_class = 'success-good' if var_success_rate >= 60 else 'success-ok' if var_success_rate >= 45 else 'success-poor'

                    html += f"""
                                <tr>
                                    <td class="variation-name">{variation}</td>
                                    <td>{var_stats['total']}</td>
                                    <td>{var_stats['wins']}</td>
                                    <td>{var_stats['draws']}</td>
                                    <td>{var_stats['losses']}</td>
                                    <td>{var_win_rate}%</td>
                                    <td class="success-rate {var_success_class}">{var_success_rate}%</td>
                                </tr>"""

                html += """
                            </table>
                        </td>
                    </tr>"""

    html += """
            </tbody>
        </table>
        <p><small><strong>Note:</strong> Success rate = (Wins + 0.5 × Draws) ÷ Total Games × 100%</small></p>
    </div>

    <div class="section">
        <h2>🎯 Key Insights</h2>
        <ul>
"""

    # Generate some insights
    if basic_stats['white_games'] > basic_stats['black_games']:
        html += f"<li>You play White more often ({basic_stats['white_games']} vs {basic_stats['black_games']} games)</li>"
    elif basic_stats['black_games'] > basic_stats['white_games']:
        html += f"<li>You play Black more often ({basic_stats['black_games']} vs {basic_stats['white_games']} games)</li>"
    else:
        html += "<li>You have a balanced distribution of White and Black games</li>"

    # Most common termination
    if terminations:
        most_common_term = max(terminations.items(), key=lambda x: x[1]['total'])
        html += f"<li>Most common game ending: {most_common_term[0]} ({most_common_term[1]['total']} games)</li>"

    # Best performing opening
    if openings:
        best_opening = max([(k, v) for k, v in openings.items() if v['total'] >= 3],
                          key=lambda x: x[1]['success_rate'], default=None)
        if best_opening:
            html += f"<li>Best performing opening (3+ games): {best_opening[0]} ({best_opening[1]['success_rate']}% success rate)</li>"

    # Most played opening
    if openings:
        most_played = max(openings.items(), key=lambda x: x[1]['total'])
        html += f"<li>Most frequently played opening: {most_played[0]} ({most_played[1]['total']} games)</li>"

    html += """
        </ul>
    </div>

    <div style="text-align: center; margin-top: 40px; padding: 20px; background: #f8f9fa; border-radius: 8px;">
        <p>Generated by <strong>Learn Chess Like a Computer</strong></p>
        <p><small>This analysis is based on your game data and provides insights to help improve your chess performance.</small></p>
    </div>

</body>
</html>
"""

    # Add JavaScript for collapsible variations and show more
    html = html.replace('</body>', '''
    <script>
        function toggleVariations(id) {
            var element = document.getElementById(id);
            if (element.style.display === 'none' || element.style.display === '') {
                element.style.display = 'table-row';
            } else {
                element.style.display = 'none';
            }
        }

        function toggleAdditionalOpenings() {
            var openingRows = document.querySelectorAll('.additional-openings.opening-row');
            var variationRows = document.querySelectorAll('.additional-openings.variations-row');
            var showMoreRow = document.querySelector('.show-more-row');
            var isHidden = openingRows[0].style.display === 'none' || openingRows[0].style.display === '';

            // Show/hide the main opening rows
            openingRows.forEach(function(element) {
                element.style.display = isHidden ? 'table-row' : 'none';
            });

            // Always hide variation rows when toggling (keep them collapsed)
            variationRows.forEach(function(element) {
                element.style.display = 'none';
            });

            if (isHidden) {
                showMoreRow.innerHTML = '<td colspan="7"><strong>Show fewer openings...</strong></td>';
            } else {
                showMoreRow.innerHTML = '<td colspan="7"><strong>Show ' + openingRows.length + ' more openings...</strong></td>';
            }
        }
    </script>
</body>''')

    return html