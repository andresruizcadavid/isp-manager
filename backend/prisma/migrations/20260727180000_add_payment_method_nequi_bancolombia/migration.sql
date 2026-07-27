-- AlterEnum: agrega los medios de pago NEQUI y BANCOLOMBIA (rieles colombianos).
-- Las rutas y la UI (RegisterPaymentModal, filtro de Facturas) ya los ofrecían,
-- pero el enum no los tenía → prisma.payment.create fallaba con
-- "Invalid value for argument `method`. Expected PaymentMethod." al registrar
-- pagos por Nequi o Bancolombia. Con estos valores el registro deja de fallar.
--
-- IF NOT EXISTS lo hace idempotente (PostgreSQL 10+). En PG 12+ ADD VALUE puede
-- correr dentro de una transacción siempre que el valor no se USE en la misma
-- transacción — este migration solo lo agrega.
ALTER TYPE "PaymentMethod" ADD VALUE IF NOT EXISTS 'NEQUI';
ALTER TYPE "PaymentMethod" ADD VALUE IF NOT EXISTS 'BANCOLOMBIA';
