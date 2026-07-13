from app.schemas.business_transformation import BusinessObjective, RiskAssessment, RiskLevel


class TransformationRiskPolicy:
    CRITICAL_TERMS = (
        "demitir",
        "contratar automaticamente",
        "transferir dinheiro",
        "pagamento automatico",
        "alterar permissao",
        "diagnostico medico",
    )
    HIGH_TERMS = (
        "financeiro",
        "credito",
        "inadimplencia",
        "rh",
        "candidato",
        "dados pessoais",
        "lgpd",
        "producao",
        "enviar email",
        "escrever no crm",
    )

    def assess(self, objective: BusinessObjective) -> RiskAssessment:
        text = " ".join(
            [
                objective.title,
                objective.description,
                objective.business_area,
                objective.expected_outcome,
                *objective.constraints,
            ]
        ).lower()
        reasons: list[str] = []

        if any(term in text for term in self.CRITICAL_TERMS):
            level = RiskLevel.CRITICAL
            reasons.append("Acao critica ou irreversivel identificada.")
        elif objective.priority == "critical" or any(term in text for term in self.HIGH_TERMS):
            level = RiskLevel.HIGH
            reasons.append("Processo regulado, sensivel ou com escrita em sistema identificado.")
        elif objective.priority == "high" or objective.involved_systems:
            level = RiskLevel.MEDIUM
            reasons.append("Integracoes ou prioridade elevada exigem validacao reforcada.")
        else:
            level = RiskLevel.LOW
            reasons.append("Caso de baixo risco com execucao simulada.")

        approval_required = level in {RiskLevel.HIGH, RiskLevel.CRITICAL}
        return RiskAssessment(
            level=level,
            reasons=reasons,
            controls=[
                "registrar todas as decisoes e tools",
                "validar dados e criterios de aceite",
                "usar menor privilegio",
                "manter rollback ou compensacao para integracoes reais",
            ],
            human_approval_required=approval_required,
            external_actions_allowed=level not in {RiskLevel.CRITICAL},
        )
